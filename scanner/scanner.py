"""Private Cloud Run receiver for one-attempt, exact-generation ClamAV scanning.

IAM must deny unauthenticated invocation. Only the dedicated Eventarc identity invokes this
service; no browser Firebase token or user-supplied bytes are accepted here.
"""
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from contextlib import contextmanager
import functions_framework
from cloudevents.http import from_http
from pathlib import Path
from tempfile import TemporaryDirectory
import json
import os
import shutil
import signal
import subprocess
import sys
import uuid

from policy import Blocked, Deadline, attachment_tuple, cvd_header, fresh_database, scan_arguments, scan_outcome, tuple_hash

PROJECT = "isp-planter-app"
UPLOAD_BUCKET = os.environ.get("ISP_UPLOAD_BUCKET", "isp-planter-app.firebasestorage.app")
MIRROR_BUCKET = os.environ.get("ISP_CLAMAV_MIRROR_BUCKET", "")
SCANNER_ID = "isp-clamav-1.4.6-v1"
CACHE = Path("/tmp/isp-clamav-definitions")
_db = _storage = None
_cached_digest = None


def clients():
    global _db, _storage
    if _db is None:
        from google.cloud import firestore, storage
        _db = firestore.Client(project=PROJECT)
        _storage = storage.Client(project=PROJECT)
    return _db, _storage


def command(arguments, timeout, deadline):
    return subprocess.run(arguments, capture_output=True, text=True, timeout=deadline.remaining(timeout), check=False, env={**os.environ, "LC_ALL": "C"})


def definitions(deadline):
    global _cached_digest
    if not MIRROR_BUCKET or MIRROR_BUCKET == UPLOAD_BUCKET:
        raise Blocked("signature_mirror_not_configured", "error")
    _, storage = clients()
    mirror = storage.bucket(MIRROR_BUCKET)
    pointer = mirror.blob("manifest.json")
    pointer.reload(timeout=deadline.remaining(10), retry=None)
    if pointer.size is None or pointer.size > 65536:
        raise Blocked("invalid_signature_manifest", "error")
    raw = pointer.download_as_bytes(if_generation_match=pointer.generation, timeout=deadline.remaining(10), retry=None)
    manifest = json.loads(raw)
    daily_version = fresh_database(manifest)
    digest = sha256(raw).hexdigest()
    if digest != _cached_digest:
        CACHE.mkdir(parents=True, exist_ok=True)
        with TemporaryDirectory(prefix="next-", dir=CACHE) as temporary:
            target = Path(temporary)
            for item in manifest["files"]:
                destination = target / item["name"]
                blob = mirror.blob(item["path"], generation=int(item["generation"]))
                blob.reload(timeout=deadline.remaining(10), retry=None)
                if blob.size != item["size"]:
                    raise Blocked("signature_size_mismatch", "error")
                blob.download_to_filename(destination, if_generation_match=int(item["generation"]), timeout=deadline.remaining(45), retry=None, checksum="crc32c")
                if sha256(destination.read_bytes()).hexdigest() != item["sha256"]:
                    raise Blocked("signature_hash_mismatch", "error")
                checked = command(["sigtool", "--info", str(destination)], 15, deadline)
                if checked.returncode != 0 or "Verification OK" not in checked.stdout + checked.stderr or cvd_header(destination) != {key: item[key] for key in ("version", "signatures", "buildEpoch")}:
                    raise Blocked("signature_verification_failed", "error")
            active = CACHE / "active"
            if active.exists():
                shutil.rmtree(active)
            shutil.move(str(target), active)
        _cached_digest = digest
    version = command(["clamscan", f"--database={CACHE / 'active'}", "--version"], 10, deadline)
    if version.returncode != 0 or not version.stdout.startswith("ClamAV 1.4.6/"):
        raise Blocked("scanner_version_mismatch", "error")
    return CACHE / "active", daily_version, version.stdout.strip()[:160], digest


def claim(attachment_id, expected, deadline):
    from google.cloud import firestore
    db, _ = clients()
    ref = db.collection("contentAttachments").document(attachment_id)
    expected_hash = tuple_hash(expected)
    attempt_id = str(uuid.uuid4())

    @firestore.transactional
    def acquire(transaction):
        snapshot = ref.get(transaction=transaction, timeout=deadline.remaining(10))
        record = snapshot.to_dict() if snapshot.exists else None
        if not record or attachment_tuple(attachment_id, record, UPLOAD_BUCKET) != expected or record.get("scanStatus") != "pending":
            return None
        existing = record.get("scanAttempt")
        # One attempt per exact tuple. Even a process crash never automatically starts another paid scan.
        if existing and existing.get("tupleHash") == expected_hash:
            if existing.get("state") == "running" and existing.get("leaseExpiresAt") and existing["leaseExpiresAt"] < datetime.now(timezone.utc):
                transaction.update(ref, {"scanStatus": "error", "scanError": {"code": "scan_attempt_expired", "at": firestore.SERVER_TIMESTAMP}})
            return None
        transaction.update(ref, {"scanAttempt": {"id": attempt_id, "tupleHash": expected_hash, "state": "running", "startedAt": firestore.SERVER_TIMESTAMP, "leaseExpiresAt": datetime.now(timezone.utc) + timedelta(minutes=9)}})
        return attempt_id

    return ref, acquire(db.transaction(max_attempts=3))


def finish(ref, expected, attempt_id, state, evidence, deadline):
    from google.cloud import firestore
    db, _ = clients()

    @firestore.transactional
    def commit(transaction):
        snapshot = ref.get(transaction=transaction, timeout=deadline.remaining(10, reserve=0))
        record = snapshot.to_dict() if snapshot.exists else None
        if not record or attachment_tuple(ref.id, record, UPLOAD_BUCKET) != expected or record.get("scanAttempt", {}).get("id") != attempt_id or record.get("scanStatus") != "pending":
            return False
        attempt = dict(record["scanAttempt"])
        attempt.update({"state": "complete", "completedAt": firestore.SERVER_TIMESTAMP})
        if state == "clean":
            transaction.update(ref, {"scanStatus": "clean", "scan": {"generation": expected["generation"], "sha256": expected["sha256"], "scannerId": SCANNER_ID, "scannedAt": firestore.SERVER_TIMESTAMP, **evidence}, "scanAttempt": attempt, "scanError": firestore.DELETE_FIELD})
        else:
            transaction.update(ref, {"scanStatus": state, "scan": None, "scanAttempt": attempt, "visibility": "private", "scanError": {"code": evidence["code"], "at": firestore.SERVER_TIMESTAMP}})
        return True

    return commit(db.transaction(max_attempts=3))


class CheckedWriter:
    def __init__(self, stream, expected):
        self.stream, self.expected, self.count, self.digest = stream, expected, 0, sha256()

    def write(self, data):
        self.count += len(data)
        if self.count > self.expected["size"]:
            raise Blocked("file_size_mismatch")
        self.digest.update(data)
        return self.stream.write(data)

    def tell(self):
        return self.stream.tell()

    def flush(self):
        self.stream.flush()

    def verify(self):
        if self.count != self.expected["size"] or self.digest.hexdigest() != self.expected["sha256"]:
            raise Blocked("file_hash_or_size_mismatch")


def scan(attachment_id, expected, deadline):
    ref, attempt_id = claim(attachment_id, expected, deadline)
    if not attempt_id:
        return "already_claimed_or_terminal"
    try:
        database, database_version, engine_version, database_digest = definitions(deadline)
        _, storage = clients()
        blob = storage.bucket(UPLOAD_BUCKET).blob(expected["storagePath"], generation=int(expected["generation"]))
        blob.reload(timeout=deadline.remaining(10), retry=None)
        if str(blob.generation) != expected["generation"] or blob.size != expected["size"] or blob.content_type != expected["contentType"] or blob.content_encoding or (blob.metadata or {}).get("firebaseStorageDownloadTokens"):
            raise Blocked("stored_metadata_mismatch")
        with TemporaryDirectory(prefix="isp-upload-") as temporary:
            path = Path(temporary) / "upload.bin"
            with path.open("wb") as stream:
                writer = CheckedWriter(stream, expected)
                blob.download_to_file(writer, raw_download=True, if_generation_match=int(expected["generation"]), timeout=deadline.remaining(30), retry=None, checksum="crc32c")
                writer.verify()
            result = command(scan_arguments(database, path), 150, deadline)
            scan_outcome(result.returncode, result.stdout + result.stderr)
            parsed = command([sys.executable, str(Path(__file__).with_name("validate_file.py")), str(path), expected["contentType"]], 30, deadline)
            if parsed.returncode != 0:
                raise Blocked("format_validation_failed")
        return "clean" if finish(ref, expected, attempt_id, "clean", {"engineVersion": engine_version, "databaseVersion": database_version, "databaseManifestSha256": database_digest}, deadline) else "stale_tuple"
    except Blocked as error:
        finish(ref, expected, attempt_id, error.state, {"code": error.code}, deadline)
        return error.state
    except subprocess.TimeoutExpired:
        finish(ref, expected, attempt_id, "error", {"code": "scan_or_validation_timeout"}, deadline)
        return "error"
    except Exception:
        finish(ref, expected, attempt_id, "error", {"code": "scanner_operation_failed"}, deadline)
        return "error"


def event_attachment(cloud_event, deadline):
    from google.events.cloud.firestore_v1.types import DocumentEventData
    if cloud_event.get("specversion") != "1.0" or cloud_event.get("type") != "google.cloud.firestore.document.v1.updated" or cloud_event.get("source") != f"//firestore.googleapis.com/projects/{PROJECT}/databases/(default)":
        return None
    if str(cloud_event.get("datacontenttype", "")).split(";")[0].lower() != "application/protobuf" or not isinstance(cloud_event.data, bytes):
        raise Blocked("invalid_firestore_event_encoding", "error")
    event = DocumentEventData.deserialize(cloud_event.data)
    before, after = event.old_value.fields, event.value.fields
    if "finalizedAt" in before or "finalizedAt" not in after or after.get("scanStatus").string_value != "pending":
        return None
    prefix = f"projects/{PROJECT}/databases/(default)/documents/contentAttachments/"
    if not event.value.name.startswith(prefix):
        return None
    attachment_id = event.value.name[len(prefix):]
    db, _ = clients()
    record = db.collection("contentAttachments").document(attachment_id).get(timeout=deadline.remaining(10)).to_dict()
    expected = attachment_tuple(attachment_id, record or {}, UPLOAD_BUCKET)
    if after.get("generation").string_value != expected["generation"] or after.get("sha256").string_value != expected["sha256"]:
        return None
    return attachment_id, expected


MAX_EVENT_BYTES = 512 * 1024


@contextmanager
def request_alarm(deadline):
    # Docker fixes WORKERS=1/THREADS=1: this runs on the synchronous worker's main thread.
    def expired(_number, _frame):
        raise Blocked("overall_scan_deadline_exceeded", "error")
    previous = signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, deadline.remaining(420, reserve=0))
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def receiver_reply(state, status=200):
    return json.dumps({"state": state}), status, {"Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def receiver_log(stage, **safe_fields):
    # Fixed stage/codes and hashes only. Never log headers, body, tokens, names or filenames.
    print(json.dumps({"event": "upload_receiver", "stage": stage, **safe_fields}), flush=True)


@functions_framework.http
def receive_event(request):
    # The official HTTP adapter parses HTTP framing and separates path from the query.
    # __GCP_CloudEventsMode/MaxAttempts are transport controls, not authority or payload formats.
    if request.method == "GET" and request.path == "/healthz":
        return receiver_reply("receiver_ready_not_scan_evidence")
    if request.method != "POST" or request.path != "/":
        receiver_log("blocked", code="invalid_request_route")
        return receiver_reply("invalid_event", 400)
    deadline = Deadline(420)
    try:
        with request_alarm(deadline):
            if request.content_length is not None and request.content_length > MAX_EVENT_BYTES:
                receiver_log("blocked", code="event_size_limit")
                return receiver_reply("invalid_event", 413)
            raw = request.stream.read(MAX_EVENT_BYTES + 1)
            if not 0 < len(raw) <= MAX_EVENT_BYTES:
                receiver_log("blocked", code="event_size_limit")
                return receiver_reply("invalid_event", 413)
            try:
                # Same CloudEvents SDK entry used by the official Python CloudEvent wrapper.
                # Identity unmarshaller preserves protobuf bytes; SDK handles standard data_base64.
                cloud_event = from_http(request.headers, raw, data_unmarshaller=lambda value: value)
            except Exception:
                receiver_log("blocked", code="invalid_cloudevent")
                return receiver_reply("invalid_event", 400)
            event_id_hash = sha256(str(cloud_event.get("id", "")).encode()).hexdigest()[:16]
            receiver_log("received", eventIdHash=event_id_hash, bodyBytes=len(raw))
            selected = event_attachment(cloud_event, deadline)
            if not selected:
                receiver_log("ignored", eventIdHash=event_id_hash)
                return receiver_reply("ignored")
            receiver_log("selected", eventIdHash=event_id_hash, attachmentId=selected[0])
            state = scan(*selected, deadline)
            receiver_log("completed", eventIdHash=event_id_hash, attachmentId=selected[0], state=state)
            return receiver_reply(state)
    except Blocked as error:
        receiver_log("blocked", code=error.code)
        return receiver_reply("blocked_event_error")
    except Exception:
        receiver_log("blocked", code="event_processing_failed")
        return receiver_reply("blocked_event_error")


if __name__ == "__main__":
    raise SystemExit("Use the pinned Functions Framework receive_event HTTP entry point.")
