"""New Job-entry and static Workflow safety contracts only; no Google/engine calls."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import sys
import unittest
import yaml

import job_entry
from policy import Blocked

ROOT = Path(__file__).resolve().parent


class JobEntryChecks(unittest.TestCase):
    def setUp(self):
        self.environment = {"ISP_ATTACHMENT_ID": "owned-cover", "ISP_ATTACHMENT_GENERATION": "7", "ISP_ATTACHMENT_SHA256": "a" * 64, "ISP_SCAN_DISPATCH_ID": "dispatch-one", "CLOUD_RUN_JOB": "isp-attachment-scan", "CLOUD_RUN_EXECUTION": "isp-attachment-scan-one", "CLOUD_RUN_TASK_INDEX": "0", "CLOUD_RUN_TASK_ATTEMPT": "0", "CLOUD_RUN_TASK_COUNT": "1"}
        self.record = {"kind": "publication", "parentId": "owned-publication", "role": "cover", "contentType": "image/png", "size": 10, "generation": "7", "sha256": "a" * 64, "finalizedAt": datetime.now(timezone.utc), "scanStatus": "pending", "bucket": "isp-planter-app.firebasestorage.app", "storagePath": "contentUploads/publication/owned-publication/owned-cover", "scanDispatch": {"id": "dispatch-one", "jobName": job_entry.JOB_NAME, "workflowExecution": job_entry.WORKFLOW_PREFIX + "dispatch-one", "generation": "7", "sha256": "a" * 64, "cancelled": False}}
        self.writes = []
        case = self
        class Reference:
            def get(self, **_kwargs):
                return SimpleNamespace(exists=case.record is not None, to_dict=lambda: deepcopy(case.record))
        class Transaction:
            def update(self, _ref, updates):
                case.writes.append(updates.copy())
                for path, value in updates.items():
                    case.record["scanDispatch"][path.split(".")[1]] = value
        class Database:
            def collection(self, _name):
                return SimpleNamespace(document=lambda _id: Reference())
            def transaction(self, **_kwargs):
                return Transaction()
        self.firestore = SimpleNamespace(transactional=lambda callback: callback, SERVER_TIMESTAMP="local-server-time")
        self.module_patch = patch.dict(sys.modules, {"google.cloud.firestore": self.firestore})
        self.module_patch.start()
        import google.cloud
        self.namespace_patch = patch.object(google.cloud, "firestore", self.firestore, create=True)
        self.namespace_patch.start()
        self.clients = patch.object(job_entry.scanner, "clients", return_value=(Database(), None)); self.clients.start()
        self.alarm = patch.object(job_entry.scanner, "request_alarm", side_effect=lambda _deadline: nullcontext()); self.alarm.start()
        self.engine = patch.object(job_entry.scanner, "scan", return_value="local_job_contract_only"); self.scan = self.engine.start()
        self.finish = patch.object(job_entry, "record_worker_finish"); self.finish.start()

    def tearDown(self):
        for item in (self.finish, self.engine, self.alarm, self.clients, self.namespace_patch, self.module_patch):
            item.stop()

    def test_matching_marker_records_execution_before_unchanged_scan(self):
        self.assertEqual(job_entry.run_job(self.environment), "local_job_contract_only")
        self.assertEqual(self.record["scanDispatch"]["executionName"], job_entry.JOB_NAME + "/executions/isp-attachment-scan-one")
        self.scan.assert_called_once()
        self.assertEqual(self.scan.call_args.args[1]["generation"], "7")

    def test_cancelled_or_malformed_cancellation_records_identity_without_scan(self):
        for value in (True, None):
            self.record["scanDispatch"]["cancelled"] = value
            self.assertEqual(job_entry.run_job(self.environment), "cancelled_or_already_claimed")
        self.assertIn("executionName", self.record["scanDispatch"])
        self.scan.assert_not_called()

    def test_changed_tuple_or_missing_marker_never_creates_or_scans(self):
        for replacement in (None, {**self.record, "generation": "8"}, {**self.record, "scanDispatch": {}}):
            self.record = replacement
            with self.assertRaises(Blocked):
                job_entry.run_job(self.environment)
        self.assertEqual(self.writes, [])
        self.scan.assert_not_called()

    def test_duplicate_different_execution_does_not_overwrite_or_rescan(self):
        job_entry.run_job(self.environment)
        original = self.record["scanDispatch"]["executionName"]
        with self.assertRaises(Blocked):
            job_entry.run_job({**self.environment, "CLOUD_RUN_EXECUTION": "isp-attachment-scan-two"})
        self.assertEqual(self.record["scanDispatch"]["executionName"], original)
        self.assertEqual(self.scan.call_count, 1)

    def test_retry_or_unowned_job_environment_is_rejected_before_dispatch(self):
        for key, value in (("CLOUD_RUN_TASK_ATTEMPT", "1"), ("CLOUD_RUN_JOB", "foreign-job"), ("CLOUD_RUN_TASK_COUNT", "2")):
            with self.assertRaises(Blocked):
                job_entry.run_job({**self.environment, key: value})
        self.assertEqual(self.writes, [])
        self.scan.assert_not_called()

    def test_actual_workflow_source_cas_single_post_error_exits_and_step_bound(self):
        workflow = yaml.safe_load((ROOT.parent / "infra/scanner-dispatch-workflow.yaml").read_text())
        steps = {next(iter(item)): next(iter(item.values())) for item in workflow["main"]["steps"]}
        labels = []
        def visit(items):
            for named in items:
                label, body = next(iter(named.items())); labels.append(label)
                self.assertNotIn("retry", body)
                if "except" in body: visit(body["except"].get("steps", []))
                for branch in body.get("switch", []):
                    self.assertNotIn("return", branch)
                    visit(branch.get("steps", []))
        visit(workflow["main"]["steps"])
        expressions = []
        def collect(value):
            if isinstance(value, dict):
                for child in value.values(): collect(child)
            elif isinstance(value, list):
                for child in value: collect(child)
            elif isinstance(value, str) and value.startswith("${") and value.endswith("}"):
                expressions.append(value)
        collect(workflow)
        self.assertTrue(expressions)
        self.assertLessEqual(max(map(len, expressions)), 400)
        print(f"All {len(expressions)} complete YAML expressions <=400 characters; maximum {max(map(len, expressions))} including delimiters.")
        self.assertEqual(len(labels), len(set(labels)))
        self.assertLessEqual((ROOT.parent / "infra/scanner-dispatch-workflow.yaml").stat().st_size, 128 * 1024)
        self.assertEqual(steps["inspectFence"]["assign"], [{"fenceFields": "${fence.body.fields}"}, {"fenceDispatch": '${map.get(fenceFields, ["scanDispatch", "mapValue", "fields"])}'}])
        expanded = steps["requireFence"]["switch"][0]["condition"].replace('map.get(fenceDispatch, [', 'map.get(fence.body.fields, ["scanDispatch", "mapValue", "fields", ').replace('fenceFields', 'fence.body.fields')
        original = '${map.get(fence.body.fields, ["scanDispatch", "mapValue", "fields", "id", "stringValue"]) != dispatchId or map.get(fence.body.fields, ["scanDispatch", "mapValue", "fields", "cancelled", "booleanValue"]) != false or map.get(fence.body.fields, ["scanStatus", "stringValue"]) != "pending" or map.get(fence.body.fields, "scanAttempt") != null or map.get(fence.body.fields, ["generation", "stringValue"]) != generation or map.get(fence.body.fields, ["sha256", "stringValue"]) != fileHash}'
        self.assertEqual(expanded, original)
        self.assertLessEqual(len(labels) * 64, 2000)
        self.assertEqual(sum(body.get("try", {}).get("call") == "http.post" for body in steps.values()), 1)
        self.assertEqual(steps["claimDispatch"]["try"]["args"]["query"]["currentDocument.updateTime"], "${document.body.updateTime}")
        # A CAS conflict/unknown exits the actual YAML before its only jobs.run POST.
        self.assertEqual(steps["claimDispatch"]["except"]["steps"][0]["claimHold"]["return"]["launchStatus"], "not_launched")
        self.assertEqual(steps["launchOnce"]["except"]["steps"][0]["launchUnknown"]["return"]["launchStatus"], "unknown")
        receipt = steps["persistReceipt"]["except"]["steps"][0]["receiptHold"]["return"]
        self.assertEqual(receipt["operationName"], "${operationName}")
        self.assertEqual(steps["persistReceipt"]["try"]["args"]["query"]["updateMask.fieldPaths"], ["scanDispatch.operationName", "scanDispatch.launchOutcome"])
        self.assertNotIn("event.data", (ROOT.parent / "infra/scanner-dispatch-workflow.yaml").read_text())
        print(f"Workflow structural bound: {len(labels)} named steps; 64 executions <= {len(labels) * 64} internal steps (no loops/retries).")


if __name__ == "__main__":
    unittest.main(verbosity=2)