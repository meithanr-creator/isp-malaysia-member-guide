"""One-shot signature mirror updater. Cooldowns survive failures; only a complete signed set switches manifest."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
import base64
import json
import os
import re
import subprocess
import sys
import uuid

from policy import Blocked, DATABASE_NAMES, MAX_DATABASE_FILE_BYTES, cvd_header, fresh_database

PROJECT = "isp-planter-app"
MIRROR_BUCKET = os.environ.get("ISP_CLAMAV_MIRROR_BUCKET", "")
ROOT = Path("/tmp/isp-cvdupdate")


def run(arguments, timeout):
    process = subprocess.run(arguments, capture_output=True, timeout=timeout, check=False, env={**os.environ, "LC_ALL": "C"})
    if process.returncode != 0:
        print(json.dumps({"event": "mirror_command_failed", "exitCode": process.returncode, "detail": process.stderr.decode(errors="replace")[-1000:]}), file=sys.stderr)
        raise Blocked("mirror_command_failed", "error")


def allowed_state(path):
    return path in {"config.json", "state.json"} or bool(re.fullmatch(r"databases/(?:main|daily|bytecode)(?:-\d+\.cdiff|\.cvd)", path))


def validate_state_index(index):
    entries = index.get("files", [])
    if index.get("schemaVersion") != 1 or not isinstance(entries, list) or len(entries) > 128:
        raise Blocked("invalid_updater_state_index", "error")
    total, seen = 0, set()
    for row in entries:
        relative, digest, size = row.get("relative"), row.get("sha256"), row.get("size")
        if not isinstance(relative, str) or not allowed_state(relative) or relative in seen or not isinstance(digest, str) or not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise Blocked("invalid_updater_state_index", "error")
        if type(size) is not int or not 0 < size <= MAX_DATABASE_FILE_BYTES or relative in {"config.json", "state.json"} and size > 65536:
            raise Blocked("invalid_updater_state_index", "error")
        if row.get("path") != f"updater-state/{digest}/{relative}" or not str(row.get("generation", "")).isdecimal():
            raise Blocked("invalid_updater_state_index", "error")
        total += size
        seen.add(relative)
    if total > 1024 * 1024 * 1024:
        raise Blocked("updater_state_size_limit", "error")
    return entries


def restore_state(bucket):
    from google.api_core.exceptions import NotFound
    pointer = bucket.blob("updater-state.json")
    try:
        pointer.reload(timeout=10, retry=None)
    except NotFound:
        return {"schemaVersion": 1, "files": []}, 0
    if pointer.size is None or pointer.size > 65536:
        raise Blocked("invalid_updater_state_index", "error")
    index = json.loads(pointer.download_as_bytes(if_generation_match=pointer.generation, timeout=15, retry=None))
    for row in validate_state_index(index):
        target = ROOT.joinpath(*PurePosixPath(row["relative"]).parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        blob = bucket.blob(row["path"], generation=int(row["generation"]))
        blob.download_to_filename(target, if_generation_match=int(row["generation"]), timeout=60, retry=None, checksum="crc32c")
        if target.stat().st_size != row["size"] or sha256(target.read_bytes()).hexdigest() != row["sha256"]:
            raise Blocked("updater_state_integrity_failed", "error")
    # No listing of historical updater/CDIFF objects is needed or permitted for restoration.
    return index, pointer.generation


def immutable_file(bucket, local, object_path):
    from google.api_core.exceptions import PreconditionFailed
    blob = bucket.blob(object_path)
    try:
        blob.upload_from_filename(local, if_generation_match=0, content_type="application/octet-stream", timeout=60, retry=None, checksum="crc32c")
    except PreconditionFailed:
        pass
    blob.reload(timeout=10, retry=None)
    if blob.size != local.stat().st_size:
        raise Blocked("mirror_object_size_mismatch", "error")
    return str(blob.generation)


def persist_state(bucket, previous_index, previous_generation, config_only=False):
    # On tool failure, preserve its updated cooldown JSON immediately and retain the prior verified database snapshot.
    entries = [row for row in previous_index["files"] if row["relative"] not in {"config.json", "state.json"}] if config_only else []
    for local in sorted(ROOT.rglob("*")):
        if not local.is_file():
            continue
        relative = local.relative_to(ROOT).as_posix()
        if not allowed_state(relative) or config_only and relative not in {"config.json", "state.json"}:
            continue
        size = local.stat().st_size
        if relative in {"config.json", "state.json"}:
            if size > 65536 or not isinstance(json.loads(local.read_text()), dict):
                raise Blocked("invalid_updater_json_state", "error")
        elif local.suffix == ".cvd":
            info = subprocess.run(["sigtool", "--info", str(local)], capture_output=True, text=True, timeout=15, check=False)
            if info.returncode != 0 or "Verification OK" not in info.stdout + info.stderr:
                raise Blocked("invalid_updater_database", "error")
        digest = sha256(local.read_bytes()).hexdigest()
        path = f"updater-state/{digest}/{relative}"
        generation = immutable_file(bucket, local, path)
        entries.append({"relative": relative, "path": path, "generation": generation, "sha256": digest, "size": size})
    index = {"schemaVersion": 1, "savedAt": datetime.now(timezone.utc).isoformat(), "files": entries}
    validate_state_index(index)
    pointer = bucket.blob("updater-state.json")
    pointer.upload_from_string(json.dumps(index, sort_keys=True), content_type="application/json", if_generation_match=previous_generation, timeout=15, retry=None)
    # Old content-addressed state objects may remain for retention, but are never relisted or restored.


def update_preserving_failure_state(update_tool, persist):
    successful = False
    try:
        update_tool()
        successful = True
    finally:
        persist(config_only=not successful)


def candidate_antivirus_self_test(database, daily_version):
    # The standard harmless EICAR pattern is decoded only inside this updater's Linux /tmp.
    # Never persist the fixture, upload it, or include engine output/bytes in receipts or logs.
    if sys.platform != "linux" or not str(ROOT).startswith("/tmp/"):
        raise Blocked("self_test_container_required", "error")
    with TemporaryDirectory(prefix="antivirus-self-test-", dir=ROOT) as temporary:
        target = Path(temporary) / "standard-test.txt"
        target.write_bytes(base64.b64decode("WDVPIVAlQEFQWzRcUFpYNTQoUF4pN0NDKTd9JEVJQ0FSLVNUQU5EQVJELUFOVElWSVJVUy1URVNULUZJTEUhJEgrSCo=", validate=True))
        version = subprocess.run(["clamscan", f"--database={database}", "--version"], capture_output=True, text=True, timeout=15, check=False, env={**os.environ, "LC_ALL": "C"})
        if version.returncode != 0 or not version.stdout.startswith("ClamAV 1.4.6/"):
            raise Blocked("self_test_engine_version_mismatch", "error")
        scanned = subprocess.run(["clamscan", f"--database={database}", "--official-db-only=yes", "--stdout", "--fail-if-cvd-older-than=2", "--max-scantime=120000", "--", str(target)], capture_output=True, text=True, timeout=150, check=False, env={**os.environ, "LC_ALL": "C"})
        output = scanned.stdout + scanned.stderr
        if scanned.returncode != 1 or "ERROR" in output or not re.search(r"(?:Win\.Test\.EICAR|Eicar)[^\r\n:]* FOUND", output, re.IGNORECASE) or not re.search(r"Scanned files:\s*1\s*(?:\r?\n|$)", output) or not re.search(r"Infected files:\s*1\s*(?:\r?\n|$)", output):
            raise Blocked("candidate_antivirus_self_test_failed", "error")
    return {"state": "passed", "engineVersion": "1.4.6", "dailyVersion": daily_version, "testedAt": datetime.now(timezone.utc).isoformat()}

def update():
    from google.api_core.exceptions import NotFound, PreconditionFailed
    from google.cloud import storage
    if not MIRROR_BUCKET:
        raise Blocked("mirror_bucket_required", "error")
    bucket = storage.Client(project=PROJECT).bucket(MIRROR_BUCKET)
    lock = bucket.blob("locks/update.lock")
    lock_generation = None
    try:
        try:
            lock.upload_from_string(json.dumps({"runId": str(uuid.uuid4())}), if_generation_match=0, timeout=15, retry=None)
        except PreconditionFailed:
            lock.reload(timeout=10, retry=None)
            if (datetime.now(timezone.utc) - lock.updated).total_seconds() < 7200:
                raise Blocked("mirror_update_already_running", "error")
            lock.delete(if_generation_match=lock.generation, timeout=10, retry=None)
            lock.upload_from_string(json.dumps({"runId": str(uuid.uuid4())}), if_generation_match=0, timeout=15, retry=None)
        lock.reload(timeout=10, retry=None)
        lock_generation = lock.generation
        ROOT.mkdir(parents=True, exist_ok=True)
        previous_index, previous_generation = restore_state(bucket)
        database, logs, config = ROOT / "databases", ROOT / "logs", ROOT / "config.json"
        database.mkdir(exist_ok=True)
        logs.mkdir(exist_ok=True)
        def update_tool():
            run([sys.executable, "-m", "cvdupdate", "config", "set", "-c", str(config), "-d", str(database), "-l", str(logs)], 15)
            run([sys.executable, "-m", "cvdupdate", "update", "-V", "-c", str(config)], 600)
        update_preserving_failure_state(update_tool, lambda config_only: persist_state(bucket, previous_index, previous_generation, config_only))
        files = []
        for name in sorted(DATABASE_NAMES):
            local = database / name
            information = subprocess.run(["sigtool", "--info", str(local)], capture_output=True, text=True, timeout=15, check=False)
            if information.returncode != 0 or "Verification OK" not in information.stdout + information.stderr:
                raise Blocked("mirror_signature_verification_failed", "error")
            size, digest, header = local.stat().st_size, sha256(local.read_bytes()).hexdigest(), cvd_header(local)
            path = f"definitions/{digest}/{name}"
            generation = immutable_file(bucket, local, path)
            files.append({"name": name, "path": path, "generation": generation, "sha256": digest, "size": size, **header})
        manifest = {"schemaVersion": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "files": files}
        manifest["antivirusSelfTest"] = candidate_antivirus_self_test(database, fresh_database(manifest))
        # Active signature pointer only advances after the entire signed, fresh database set is complete.
        pointer = bucket.blob("manifest.json")
        try:
            pointer.reload(timeout=10, retry=None)
            previous = pointer.generation
        except NotFound:
            previous = 0
        pointer.upload_from_string(json.dumps(manifest, sort_keys=True), content_type="application/json", if_generation_match=previous, timeout=15, retry=None)
        print(json.dumps({"state": "mirror_updated", "dailyVersion": fresh_database(manifest)}))
    finally:
        if lock_generation is not None:
            lock.delete(if_generation_match=lock_generation, timeout=10, retry=None)


if __name__ == "__main__":
    try:
        update()
    except Exception:
        print(json.dumps({"state": "mirror_update_failed"}), file=sys.stderr)
        sys.exit(1)
