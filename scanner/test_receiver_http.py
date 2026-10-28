"""Actual loopback HTTP/CloudEvents/protobuf adapter checks; no engine or Google clients."""
from contextlib import nullcontext, redirect_stdout
from datetime import datetime, timezone
from hashlib import sha256
from http.client import HTTPConnection
from io import StringIO
from pathlib import Path
from threading import Thread
from unittest.mock import patch
import base64
import json
import os
import signal
import sys
import unittest

import functions_framework
from google.events.cloud.firestore_v1.types import DocumentEventData
from werkzeug.serving import make_server, WSGIRequestHandler

ROOT = Path(__file__).resolve().parent
QUERY = "/?__GCP_CloudEventsMaxAttempts=1&__GCP_CloudEventsMode=CE_PUBSUB_BINDING"
ATTACHMENT = "local-adapter-cover"
PARENT = "local-adapter-publication"
SOURCE = "//firestore.googleapis.com/projects/isp-planter-app/databases/(default)"
SENSITIVE = "PRIVATE_FILENAME_MUST_NOT_LOG.pdf"


class QuietRequestHandler(WSGIRequestHandler):
    def log(self, *_args, **_kwargs):
        pass


class ReceiverHttp(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = functions_framework.create_app(target="receive_event", source=str(ROOT / "scanner.py"), signature_type="http")
        cls.receiver = sys.modules["scanner"]
        cls.server = make_server("127.0.0.1", 0, cls.app, threaded=False, request_handler=QuietRequestHandler)
        cls.thread = Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=3)

    def setUp(self):
        self.selected = []
        self.reads = []
        self.logs = StringIO()
        self.record = {"kind": "publication", "parentId": PARENT, "role": "cover", "contentType": "image/png", "size": 10, "generation": "123", "sha256": "a" * 64, "finalizedAt": datetime.now(timezone.utc), "bucket": "isp-planter-app.firebasestorage.app", "storagePath": f"contentUploads/publication/{PARENT}/{ATTACHMENT}", "fileName": SENSITIVE}
        receiver_test = self

        class Snapshot:
            def to_dict(self):
                return receiver_test.record.copy()

        class Ref:
            def get(self, **_kwargs):
                receiver_test.reads.append(ATTACHMENT)
                return Snapshot()

        class Collection:
            def document(self, attachment):
                assert attachment == ATTACHMENT
                return Ref()

        class Database:
            def collection(self, name):
                assert name == "contentAttachments"
                return Collection()

        def scan(attachment, expected, _deadline):
            self.selected.append((attachment, expected))
            return "local_http_contract_only"

        self.patches = [patch.object(self.receiver, "clients", return_value=(Database(), None)), patch.object(self.receiver, "scan", side_effect=scan), patch.object(self.receiver, "request_alarm", side_effect=lambda _deadline: nullcontext())]
        for item in self.patches:
            item.start()

        self.output_redirect = redirect_stdout(self.logs)
        self.output_redirect.__enter__()

    def tearDown(self):
        self.output_redirect.__exit__(None, None, None)
        for item in reversed(self.patches):
            item.stop()
        self.assertNotIn(SENSITIVE, self.logs.getvalue())
        self.assertNotIn("LOCAL_AUTH_HEADER_MUST_NOT_LOG", self.logs.getvalue())

    def payload(self, *, generation="123", self_update=False):
        fields = {"finalizedAt": {"timestamp_value": datetime.now(timezone.utc)}, "scanStatus": {"string_value": "pending"}, "generation": {"string_value": generation}, "sha256": {"string_value": "a" * 64}, "fileName": {"string_value": SENSITIVE}}
        old = {"fields": {"finalizedAt": {"timestamp_value": datetime.now(timezone.utc)}}} if self_update else {"fields": {"scanStatus": {"string_value": "pending"}}}
        event = DocumentEventData(value={"name": f"projects/isp-planter-app/databases/(default)/documents/contentAttachments/{ATTACHMENT}", "fields": fields}, old_value=old)
        return DocumentEventData.serialize(event)

    def headers(self):
        return {"Ce-Specversion": "1.0", "Ce-Id": "local-event-id", "Ce-Type": "google.cloud.firestore.document.v1.updated", "Ce-Source": SOURCE, "Content-Type": "application/protobuf", "Authorization": "Bearer LOCAL_AUTH_HEADER_MUST_NOT_LOG"}

    def post(self, body, headers, path=QUERY):
        connection = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request("POST", path, body=body, headers=headers)
            response = connection.getresponse()
            data = json.loads(response.read())
            return response.status, data
        finally:
            connection.close()

    def test_binary_protobuf_query_path_and_authoritative_tuple(self):
        status, data = self.post(self.payload(), self.headers())
        self.assertEqual((status, data["state"]), (200, "local_http_contract_only"))
        self.assertEqual(self.reads, [ATTACHMENT])
        self.assertEqual(self.selected[0][0], ATTACHMENT)
        self.assertEqual(self.selected[0][1]["generation"], "123")
        self.assertEqual(self.selected[0][1]["sha256"], "a" * 64)

    def test_standard_structured_data_base64_uses_official_sdk(self):
        body = json.dumps({"specversion": "1.0", "id": "structured-probe", "type": "google.cloud.firestore.document.v1.updated", "source": SOURCE, "datacontenttype": "application/protobuf", "data_base64": base64.b64encode(self.payload()).decode()}).encode()
        status, data = self.post(body, {"Content-Type": "application/cloudevents+json"})
        self.assertEqual((status, data["state"]), (200, "local_http_contract_only"))
        self.assertEqual(len(self.selected), 1)

    def test_query_does_not_authorize_arbitrary_pubsub_wrapper_or_wrong_route(self):
        wrapped = json.dumps({"message": {"data": base64.b64encode(self.payload()).decode()}}).encode()
        self.assertEqual(self.post(wrapped, {"Content-Type": "application/json"})[0], 400)
        self.assertEqual(self.post(self.payload(), self.headers(), "/wrong?__GCP_CloudEventsMode=CE_PUBSUB_BINDING")[0], 400)
        self.assertEqual(self.selected, [])
        self.assertEqual(self.reads, [])

    def test_wrong_metadata_self_update_and_changed_generation_never_dispatch(self):
        for field, value in [("Ce-Source", SOURCE.replace("isp-planter-app", "other-project")), ("Ce-Type", "google.cloud.firestore.document.v1.created")]:
            headers = self.headers(); headers[field] = value
            self.assertEqual(self.post(self.payload(), headers)[1]["state"], "ignored")
        self.assertEqual(self.post(self.payload(self_update=True), self.headers())[1]["state"], "ignored")
        self.assertEqual(self.post(self.payload(generation="124"), self.headers())[1]["state"], "ignored")
        self.assertEqual(self.selected, [])

    def test_malformed_wrong_content_type_and_oversized_are_blocked_without_clean(self):
        for body, headers in [(b"not-a-protobuf", self.headers()), (self.payload(), {**self.headers(), "Content-Type": "application/json"})]:
            status, data = self.post(body, headers)
            self.assertEqual(data["state"], "blocked_event_error")
            self.assertEqual(status, 200)  # Definitive blocked receipt; never clean and no mutation replay.
        status, data = self.post(b"x" * (512 * 1024 + 1), self.headers())
        self.assertEqual((status, data["state"]), (413, "invalid_event"))
        self.assertEqual(self.selected, [])

    def test_pinned_sync_worker_and_alarm_outer_timeout_contract(self):
        docker = (ROOT / "Dockerfile").read_text()
        self.assertIn("WORKERS=1 THREADS=1 CLOUD_RUN_TIMEOUT_SECONDS=480", docker)
        self.assertIn('"--target=receive_event", "--signature-type=http"', docker)
        # Only the alarm system calls are substituted on Windows; no real timer/engine/cloud runs.
        self.patches[2].stop()
        clock = self.receiver.Deadline(420, clock=lambda: 0)
        with patch.object(signal, "SIGALRM", 14, create=True), patch.object(signal, "ITIMER_REAL", 0, create=True), patch.object(signal, "signal", return_value="prior") as handler, patch.object(signal, "setitimer", create=True) as timer:
            with self.receiver.request_alarm(clock):
                pass
            self.assertEqual(timer.call_args_list[0].args, (0, 420))
            self.assertEqual(timer.call_args_list[-1].args, (0, 0))
            self.assertEqual(handler.call_args_list[-1].args, (14, "prior"))
        self.patches[2].start()


if __name__ == "__main__":
    unittest.main(verbosity=2)