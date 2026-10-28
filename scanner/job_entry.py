"""One task per server-issued dispatch. No HTTP delivery, keys, input bytes or retries."""
from datetime import datetime, timezone
import json
import os
import re
import sys

import scanner
from policy import Blocked, Deadline, attachment_tuple

JOB_NAME = "projects/isp-planter-app/locations/asia-southeast1/jobs/isp-attachment-scan"
WORKFLOW_PREFIX = "projects/isp-planter-app/locations/asia-southeast1/workflows/isp-attachment-dispatch/executions/"
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,80}")


def binding_from_environment(environment):
    values = {key: environment.get(key, "") for key in ("ISP_ATTACHMENT_ID", "ISP_ATTACHMENT_GENERATION", "ISP_ATTACHMENT_SHA256", "ISP_SCAN_DISPATCH_ID")}
    if not IDENTIFIER.fullmatch(values["ISP_ATTACHMENT_ID"]) or not re.fullmatch(r"[0-9]+", values["ISP_ATTACHMENT_GENERATION"]) or not re.fullmatch(r"[a-f0-9]{64}", values["ISP_ATTACHMENT_SHA256"]) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", values["ISP_SCAN_DISPATCH_ID"]):
        raise Blocked("invalid_dispatch_environment", "error")
    execution = environment.get("CLOUD_RUN_EXECUTION", "")
    if environment.get("CLOUD_RUN_JOB") != "isp-attachment-scan" or not re.fullmatch(r"isp-attachment-scan-[a-z0-9-]{1,80}", execution) or environment.get("CLOUD_RUN_TASK_INDEX") != "0" or environment.get("CLOUD_RUN_TASK_ATTEMPT") != "0" or environment.get("CLOUD_RUN_TASK_COUNT") != "1":
        raise Blocked("invalid_owned_job_execution", "error")
    return {"attachmentId": values["ISP_ATTACHMENT_ID"], "generation": values["ISP_ATTACHMENT_GENERATION"], "sha256": values["ISP_ATTACHMENT_SHA256"], "dispatchId": values["ISP_SCAN_DISPATCH_ID"], "executionName": JOB_NAME + "/executions/" + execution}


def dispatch_matches(record, binding):
    marker = record.get("scanDispatch", {})
    return isinstance(marker, dict) and marker.get("id") == binding["dispatchId"] and marker.get("jobName") == JOB_NAME and marker.get("workflowExecution") == WORKFLOW_PREFIX + binding["dispatchId"] and marker.get("generation") == binding["generation"] and marker.get("sha256") == binding["sha256"] and record.get("generation") == binding["generation"] and record.get("sha256") == binding["sha256"]


def prepare_owned_execution(binding, deadline):
    from google.cloud import firestore
    db, _ = scanner.clients()
    ref = db.collection("contentAttachments").document(binding["attachmentId"])

    @firestore.transactional
    def record_execution(transaction):
        snapshot = ref.get(transaction=transaction, timeout=deadline.remaining(10))
        record = snapshot.to_dict() if snapshot.exists else None
        if not record or not dispatch_matches(record, binding):
            raise Blocked("dispatch_binding_changed", "error")
        marker = record["scanDispatch"]
        if marker.get("executionName") not in (None, "", binding["executionName"]):
            raise Blocked("different_execution_already_recorded", "error")
        # Record even a tombstoned/late worker so an ambiguous launch can be reconciled.
        # Updating only an existing doc never recreates a deleted fixture.
        transaction.update(ref, {"scanDispatch.executionName": binding["executionName"], "scanDispatch.workerState": "started" if marker.get("cancelled") is False else "cancelled_before_scan", "scanDispatch.workerStartedAt": firestore.SERVER_TIMESTAMP})
        if marker.get("cancelled") is not False:
            return None
        if record.get("scanStatus") != "pending" or record.get("scanAttempt"):
            return None
        return attachment_tuple(binding["attachmentId"], record, scanner.UPLOAD_BUCKET)

    return ref, record_execution(db.transaction(max_attempts=3))


def record_worker_finish(ref, binding, state, deadline):
    from google.cloud import firestore
    db, _ = scanner.clients()

    @firestore.transactional
    def complete(transaction):
        snapshot = ref.get(transaction=transaction, timeout=deadline.remaining(10, reserve=0))
        record = snapshot.to_dict() if snapshot.exists else None
        if record and dispatch_matches(record, binding) and record["scanDispatch"].get("executionName") == binding["executionName"]:
            transaction.update(ref, {"scanDispatch.workerState": "complete", "scanDispatch.workerResult": state, "scanDispatch.workerFinishedAt": firestore.SERVER_TIMESTAMP})

    complete(db.transaction(max_attempts=3))


def run_job(environment=None):
    deadline = Deadline(420)
    binding = binding_from_environment(os.environ if environment is None else environment)
    with scanner.request_alarm(deadline):
        ref, expected = prepare_owned_execution(binding, deadline)
        if expected is None:
            return "cancelled_or_already_claimed"
        # The unchanged scan() performs its existing atomic one-attempt claim and exact tuple checks.
        state = scanner.scan(binding["attachmentId"], expected, deadline)
        record_worker_finish(ref, binding, state, deadline)
        return state


if __name__ == "__main__":
    try:
        result = run_job()
        print(json.dumps({"event": "scan_job", "state": result}), flush=True)
        sys.exit(0 if result in {"clean", "rejected", "infected", "cancelled_or_already_claimed", "already_claimed_or_terminal"} else 1)
    except Exception:
        print(json.dumps({"event": "scan_job", "state": "blocked_job_error"}), flush=True)
        sys.exit(1)