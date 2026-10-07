import copy
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("cd_controller", Path(__file__).with_name("controller.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Controller, atomic_json, PolicyError = module.Controller, module.atomic_json, module.PolicyError


class Rehearsal(Controller):
    def __init__(self, config):
        super().__init__(config)
        self.calls = []
        self.fail_candidate = False
        self.fail_rollback = False
        self.fail_snapshot = False
        self.data = {"result": "passed", "counts": {"trace_event": 40}, "fingerprints": {"event": "unchanged"}, "canary": None}

    def preflight(self, record):
        self.calls.append("preflight")

    def applied(self, record):
        return {"20260101_init": "a" * 64}

    def verify(self, record, canary=None):
        self.calls.append("verify-" + record["id"])
        if self.fail_candidate and record["id"].endswith("b" * 40):
            self.phase = "release-verification"
            raise PolicyError("simulated candidate failure")
        if self.fail_rollback and record["id"].endswith("a" * 40):
            # Only fail rollback after a candidate was started, not the baseline check.
            if "start-uat-" + "b" * 40 in self.calls:
                raise PolicyError("simulated old health failure")
        result = copy.deepcopy(self.data)
        result["canary"] = canary
        return result

    def stop(self, record):
        self.calls.append("stop-" + record["id"])

    def start(self, record):
        self.calls.append("start-" + record["id"])

    def snapshot(self, old, attempt, baseline):
        self.calls.append("snapshot")
        if self.fail_snapshot:
            self.phase = "encrypted-offsite-backup"
            raise PolicyError("simulated backup failure")
        return "private-backup"

    def run(self, label, args, **kwargs):
        self.calls.append(label)
        return b""

    def restore_definition(self, state, previous):
        self.calls.append("reconcile-definition")
        return state["chaincode"]


@unittest.skipIf(os.name == "nt", "Controller uses Linux durable directory fsync; policy tests remain portable")
class DeliveryFailureRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        (self.base / "cd").mkdir()
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=http://13.140.170.166\n")
        self.controller = Rehearsal({"base": str(self.base), "env": str(env)})
        self.old = {"id": "uat-" + "a" * 40, "sha": "a" * 40, "directory": str(self.base / "old"), "verified": True,
                    "manifest": {"chaincode": "c" * 64, "api": "api:old", "web": "web:old", "migrations": {"20260101_init": "a" * 64}}}
        self.candidate = dict(copy.deepcopy(self.old), id="uat-" + "b" * 40, sha="b" * 40, directory=str(self.base / "new"), verified=False)
        self.controller.save_record(self.old)
        self.controller.save_record(self.candidate)
        self.state = {"current": self.old["id"], "chaincode": {"sequence": 1, "version": "1.0", "packages": {"1": "old", "2": "old"}, "fingerprint": "c" * 64}, "compatible_migrations": []}
        atomic_json(self.base / "cd/state.json", self.state)
        (self.base / "current").symlink_to(self.old["directory"])

    def test_success_updates_current_only_after_verification(self):
        result = self.controller.rollout(self.candidate, self.state)
        self.assertEqual(result["result"], "passed")
        self.assertEqual(self.controller.state()["current"], self.candidate["id"])
        self.assertEqual(self.controller.state()["previous"], self.old["id"])
        self.assertFalse((self.base / "cd/journal.json").exists())
        self.assertLess(self.controller.calls.index("snapshot"), self.controller.calls.index("migration-deploy"))

    def test_candidate_failure_restores_old_app_without_data_restore(self):
        self.controller.fail_candidate = True
        with self.assertRaisesRegex(PolicyError, "rollback=verified"):
            self.controller.rollout(self.candidate, self.state)
        self.assertEqual(self.controller.state()["current"], self.old["id"])
        self.assertIn("start-" + self.old["id"], self.controller.calls)
        self.assertEqual(self.controller.data["fingerprints"], {"event": "unchanged"})
        self.assertFalse(any("restore" in call or "down" in call for call in self.controller.calls))

    def test_backup_failure_resumes_old_and_never_runs_migration(self):
        self.controller.fail_snapshot = True
        with self.assertRaisesRegex(PolicyError, "rollback=verified"):
            self.controller.rollout(self.candidate, self.state)
        self.assertNotIn("migration-deploy", self.controller.calls)
        self.assertIn("start-" + self.old["id"], self.controller.calls)

    def test_failed_rollback_leaves_recoverable_journal(self):
        self.controller.fail_candidate = self.controller.fail_rollback = True
        with self.assertRaisesRegex(PolicyError, "recovery-required"):
            self.controller.rollout(self.candidate, self.state)
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.controller.fail_candidate = self.controller.fail_rollback = False
        self.assertEqual(self.controller.recover()["result"], "recovered")
        self.assertFalse((self.base / "cd/journal.json").exists())

    def test_chaincode_change_blocks_before_writers_stop(self):
        self.candidate["manifest"]["chaincode"] = "d" * 64
        with self.assertRaisesRegex(PolicyError, "Chaincode changed"):
            self.controller.rollout(self.candidate, self.state)
        self.assertNotIn("stop-" + self.old["id"], self.controller.calls)

    def test_deleted_or_changed_history_is_detected(self):
        for after in ({"fingerprints": {}, "counts": {"trace_event": 40}},
                      {"fingerprints": {"event": "mutated"}, "counts": {"trace_event": 40}},
                      {"fingerprints": {"event": "unchanged"}, "counts": {"trace_event": 39}}):
            with self.assertRaises(PolicyError):
                Controller.preserve(self.controller.data, after)


if __name__ == "__main__":
    unittest.main()
