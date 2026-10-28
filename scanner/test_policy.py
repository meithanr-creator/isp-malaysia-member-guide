"""Only policy checks. These do not run ClamAV or claim an antivirus PASS."""
from datetime import datetime, timezone
import unittest
from policy import Blocked, attachment_tuple, fresh_database, scan_outcome, tuple_hash


class ScanPolicyChecks(unittest.TestCase):
    def record(self):
        return {"kind": "publication", "parentId": "book", "role": "pdf", "bucket": "private", "storagePath": "contentUploads/publication/book/file", "size": 25 * 1024 * 1024, "generation": "123", "sha256": "a" * 64, "contentType": "application/pdf", "finalizedAt": datetime.now(timezone.utc)}

    def test_exact_tuple_and_size(self):
        record = self.record()
        first = attachment_tuple("file", record, "private")
        self.assertEqual(first["generation"], "123")
        second = attachment_tuple("file", {**record, "generation": "124"}, "private")
        self.assertNotEqual(tuple_hash(first), tuple_hash(second))
        for change in [{"size": record["size"] + 1}, {"storagePath": "other/path"}, {"sha256": "bad"}, {"contentType": "text/html"}, {"generation": ""}]:
            with self.assertRaises(Blocked):
                attachment_tuple("file", {**record, **change}, "private")

    def manifest(self, epoch):
        return {"schemaVersion": 1, "checkedAt": datetime.now(timezone.utc).isoformat(), "files": [{"name": name, "path": f"definitions/{'a' * 64}/{name}", "sha256": "a" * 64, "size": 100, "generation": "1", "buildEpoch": epoch, "version": 100, "signatures": 1000} for name in ["main.cvd", "daily.cvd", "bytecode.cvd"]]}

    def test_actual_daily_signature_age_not_mirror_refresh_controls_gate(self):
        self.assertEqual(fresh_database(self.manifest(100000), 100001), 100)
        with self.assertRaisesRegex(Blocked, "stale_signature_database"):
            fresh_database(self.manifest(100000), 100000 + 49 * 3600)
        with self.assertRaises(Blocked):
            fresh_database(self.manifest(100000), 100000 - 301)

    def test_only_complete_zero_detection_engine_result_can_be_clean(self):
        scan_outcome(0, "Scanned files: 1\nInfected files: 0\n")
        for code, result in [(1, "upload.bin: Eicar-Signature FOUND"), (1, "Heuristics.Limits.Exceeded FOUND"), (1, "Heuristics.Encrypted.PDF FOUND"), (2, "ERROR: failed scan"), (0, ""), (0, "Scanned files: 0\nInfected files: 0")]:
            with self.assertRaises(Blocked):
                scan_outcome(code, result)

    def test_manifest_requires_full_private_content_addressed_database_set(self):
        manifest = self.manifest(100000)
        manifest["files"][0]["path"] = "https://untrusted.invalid/main.cvd"
        with self.assertRaises(Blocked):
            fresh_database(manifest, 100001)
        manifest = self.manifest(100000)
        manifest["files"].pop()
        with self.assertRaises(Blocked):
            fresh_database(manifest, 100001)


if __name__ == "__main__":
    unittest.main()
