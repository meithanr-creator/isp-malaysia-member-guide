"""Fail-closed scan policy. No network clients or malware engine run in this module."""
from datetime import datetime, timezone
from hashlib import sha256
import re
import time

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_DATABASE_BYTES = 512 * 1024 * 1024
MAX_DATABASE_FILE_BYTES = 256 * 1024 * 1024
MAX_DATABASE_AGE_SECONDS = 48 * 3600
DATABASE_NAMES = {"main.cvd", "daily.cvd", "bytecode.cvd"}
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
HASH = re.compile(r"^[a-f0-9]{64}$")


class Blocked(Exception):
    def __init__(self, code, state="rejected"):
        self.code = code
        self.state = state
        super().__init__(code)


def attachment_tuple(attachment_id, record, expected_bucket):
    if not IDENTIFIER.fullmatch(attachment_id):
        raise Blocked("invalid_attachment_id")
    kind, parent, role = (record.get(key) for key in ("kind", "parentId", "role"))
    if kind not in {"event", "discover", "publication"} or not isinstance(parent, str) or not IDENTIFIER.fullmatch(parent):
        raise Blocked("invalid_parent")
    mime = record.get("contentType")
    if mime in {"image/jpeg", "image/png", "image/webp"} and ((role == "image" and kind in {"event", "discover"}) or (role == "cover" and kind == "publication")):
        limit = 5 * 1024 * 1024
    elif mime == "application/pdf" and role == "brochure" and kind == "event":
        limit = 10 * 1024 * 1024
    elif mime == "application/pdf" and role == "pdf" and kind == "publication":
        limit = MAX_FILE_BYTES
    else:
        raise Blocked("unsupported_format")
    size, generation, digest = (record.get(key) for key in ("size", "generation", "sha256"))
    if type(size) is not int or not 0 < size <= limit or size > MAX_FILE_BYTES:
        raise Blocked("invalid_size")
    path = f"contentUploads/{kind}/{parent}/{attachment_id}"
    if record.get("bucket") != expected_bucket or record.get("storagePath") != path:
        raise Blocked("invalid_storage_path")
    if not isinstance(generation, str) or not generation.isdecimal() or not isinstance(digest, str) or not HASH.fullmatch(digest) or not record.get("finalizedAt"):
        raise Blocked("not_finalized")
    return {"attachmentId": attachment_id, "bucket": expected_bucket, "storagePath": path, "generation": generation, "sha256": digest, "size": size, "contentType": mime}


def tuple_hash(value):
    return sha256("\n".join(str(value[key]) for key in ("attachmentId", "bucket", "storagePath", "generation", "sha256", "size", "contentType")).encode()).hexdigest()


def cvd_header(path):
    with open(path, "rb") as stream:
        header = stream.read(512).decode("ascii").strip(" \x00\r\n").split(":")
    if len(header) < 9 or header[0] != "ClamAV-VDB":
        raise Blocked("invalid_signature_database", "error")
    try:
        return {"version": int(header[2]), "signatures": int(header[3]), "buildEpoch": int(header[8].strip())}
    except (ValueError, IndexError) as error:
        raise Blocked("invalid_signature_database", "error") from error


def fresh_database(manifest, now_epoch=None):
    now_epoch = now_epoch or datetime.now(timezone.utc).timestamp()
    files = manifest.get("files", [])
    if manifest.get("schemaVersion") != 1 or len(files) != 3 or {row.get("name") for row in files} != DATABASE_NAMES:
        raise Blocked("invalid_signature_manifest", "error")
    total = 0
    for row in files:
        if not isinstance(row.get("sha256"), str) or not HASH.fullmatch(row["sha256"]) or not isinstance(row.get("generation"), str) or not row["generation"].isdecimal():
            raise Blocked("invalid_signature_manifest", "error")
        size = row.get("size")
        if type(size) is not int or not 0 < size <= MAX_DATABASE_FILE_BYTES or row.get("path") != f"definitions/{row['sha256']}/{row['name']}":
            raise Blocked("invalid_signature_manifest", "error")
        total += size
    if total > MAX_DATABASE_BYTES:
        raise Blocked("signature_database_too_large", "error")
    daily = next(row for row in files if row["name"] == "daily.cvd")
    epoch = daily.get("buildEpoch")
    if type(epoch) is not int or epoch > now_epoch + 300 or now_epoch - epoch > MAX_DATABASE_AGE_SECONDS:
        raise Blocked("stale_signature_database", "error")
    return daily["version"]


def scan_arguments(database_dir, path):
    return ["clamscan", f"--database={database_dir}", "--stdout", "--fail-if-cvd-older-than=2", "--alert-exceeds-max=yes", "--alert-encrypted=yes", "--alert-broken=yes", "--alert-broken-media=yes", "--max-filesize=25M", "--max-scansize=100M", "--max-recursion=16", "--max-files=1000", "--max-scantime=120000", "--", str(path)]


def scan_outcome(exit_code, output):
    if exit_code == 1:
        if "Heuristics.Limits.Exceeded" in output or "Heuristics.Encrypted" in output or "Heuristics.Broken" in output:
            raise Blocked("uninspectable_or_limit_exceeded")
        raise Blocked("malware_detected", "infected")
    if exit_code != 0 or "ERROR:" in output or " FOUND" in output or not re.search(r"Scanned files:\s*[1-9]\d*", output) or not re.search(r"Infected files:\s*0\b", output):
        raise Blocked("scan_did_not_complete", "error")

class Deadline:
    """Whole-request monotonic budget; normal work reserves40seconds for result/ack."""
    def __init__(self, seconds=420, clock=None):
        self.clock = clock or time.monotonic
        self.ends_at = self.clock() + seconds

    def remaining(self, maximum, reserve=40):
        remaining = self.ends_at - self.clock() - reserve
        if remaining <= 0:
            raise Blocked("overall_scan_deadline_exceeded", "error")
        return min(maximum, remaining)
