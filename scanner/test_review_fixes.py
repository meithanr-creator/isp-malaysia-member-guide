"""Targeted source-review failure checks only; no engine, provider or existing suite."""
import unittest
from policy import Blocked, Deadline
from mirror import update_preserving_failure_state, validate_state_index


class ScannerReviewFixes(unittest.TestCase):
    def test_overall_deadline_reserves_finish_budget(self):
        clock = [0]
        deadline = Deadline(420, lambda: clock[0])
        self.assertEqual(deadline.remaining(150), 150)
        clock[0] = 360
        self.assertEqual(deadline.remaining(150), 20)
        clock[0] = 381
        with self.assertRaisesRegex(Blocked, "overall_scan_deadline_exceeded"):
            deadline.remaining(10)
        self.assertEqual(deadline.remaining(10, reserve=0), 10)
        clock[0] = 421
        with self.assertRaises(Blocked):
            deadline.remaining(1, reserve=0)

    def test_failed_update_persists_cooldown_and_never_reaches_activation(self):
        state, saved, activated = {}, [], []
        def failed_tool():
            state["retry after"] = 86400
            raise Blocked("upstream_429", "error")
        def persist(config_only):
            saved.append({"config_only": config_only, "state": dict(state)})
        with self.assertRaisesRegex(Blocked, "upstream_429"):
            update_preserving_failure_state(failed_tool, persist)
            activated.append("must never run")
        self.assertEqual(saved, [{"config_only": True, "state": {"retry after": 86400}}])
        self.assertEqual(activated, [])

    def test_atomic_state_index_contains_current_cdiffs_without_historical_listing(self):
        current = {"relative": "databases/daily-123.cdiff", "path": f"updater-state/{'a'*64}/databases/daily-123.cdiff", "generation": "123", "sha256": "a"*64, "size": 10}
        self.assertEqual(validate_state_index({"schemaVersion": 1, "files": [current]}), [current])
        # Old remote objects have no input to this exact index and cannot displace current entries.
        with self.assertRaises(Blocked):
            validate_state_index({"schemaVersion": 1, "files": [current]*129})
        with self.assertRaises(Blocked):
            validate_state_index({"schemaVersion": 1, "files": [{**current, "relative": "../other"}]})


if __name__ == "__main__":
    unittest.main()
