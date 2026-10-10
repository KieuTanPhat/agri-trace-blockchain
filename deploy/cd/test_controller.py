import copy
import importlib.util
import json
import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch
from pathlib import Path

spec = importlib.util.spec_from_file_location("cd_controller", Path(__file__).with_name("controller.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Controller, atomic_json, PolicyError = module.Controller, module.atomic_json, module.PolicyError


class DomainDelivery(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=https://agritrace.dev\n"
                       "CORS_ORIGINS=http://13.140.170.166,https://agritrace.dev,https://www.agritrace.dev\n")
        accounts = self.base / "accounts.json"
        accounts.write_text("[]")
        self.controller = Controller({"base": str(self.base), "env": str(env), "accounts": str(accounts),
                                      "origin": "https://agritrace.dev", "legacy_origin": "http://13.140.170.166"})
        self.legacy = {"id": "uat-" + "a" * 40, "directory": str(self.base / "old"), "manifest": {}}
        self.domain = {"id": "uat-" + "b" * 40, "directory": str(self.base / "new"),
                       "manifest": {"origin": "https://agritrace.dev"}}

    def test_legacy_http_origin_and_cors_survive_domain_cutover(self):
        for record, origin, expected_cors, https in (
                (self.legacy, "http://13.140.170.166", "http://13.140.170.166", False),
                (self.domain, "https://agritrace.dev", self.controller.environment["CORS_ORIGINS"], True)):
            command = self.controller.dc(record, "config")
            values = module.policy.read_env(self.base / "cd/records" / record["id"] / "origin.env")
            self.assertEqual(values, {"PUBLIC_ORIGIN": origin, "CORS_ORIGINS": expected_cors})
            self.assertEqual(any(value.endswith("docker-compose.uat-https.yml") for value in command), https)
            self.assertEqual(command.count("--env-file"), 2)
        # Switching back must not inherit the new public URL or CORS list.
        self.controller.dc(self.legacy, "up")
        self.assertEqual(self.controller.origin_for(self.legacy), "http://13.140.170.166")

    def test_verifier_receives_the_release_origin_and_cors(self):
        self.controller.run = MagicMock(return_value=b'{"result":"passed"}')
        self.controller.verify(self.domain)
        payload = json.loads(self.controller.run.call_args.args[2])
        self.assertEqual(payload["origin"], "https://agritrace.dev")
        self.assertEqual(payload["corsOrigins"], self.controller.environment["CORS_ORIGINS"].split(","))

    @staticmethod
    def response():
        response = MagicMock()
        response.__enter__.return_value.status = 200
        return response

    def test_www_tls_failure_blocks_release_with_the_correct_phase(self):
        self.controller.run = MagicMock(return_value=b"")
        with patch.object(module.time, "monotonic", side_effect=[0, 1, 181]), \
                patch.object(module.time, "sleep"), \
                patch.object(module.urllib.request, "urlopen", side_effect=[self.response(), OSError("TLS failure")]) as request:
            with self.assertRaisesRegex(PolicyError, "apex and www"):
                self.controller.start(self.domain)
        self.assertEqual(self.controller.phase, "public-https-readiness")
        self.assertEqual([call.args[0] for call in request.call_args_list],
                         ["https://agritrace.dev/login", "https://www.agritrace.dev/login"])

    def test_both_https_routes_must_succeed_before_returning_ready(self):
        self.controller.run = MagicMock(return_value=b"")
        with patch.object(module.time, "monotonic", side_effect=[0, 1, 2]), \
                patch.object(module.time, "sleep") as sleep, \
                patch.object(module.urllib.request, "urlopen",
                             side_effect=[self.response(), OSError("not yet ready"), self.response(), self.response()]) as request:
            self.controller.start(self.domain)
        self.assertEqual(request.call_count, 4)
        sleep.assert_called_once_with(5)

    def test_legacy_http_release_does_not_wait_for_domain_tls(self):
        self.controller.run = MagicMock(return_value=b"")
        with patch.object(module.urllib.request, "urlopen") as request:
            self.controller.start(self.legacy)
        request.assert_not_called()


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

    def test_recover_after_state_promotion_restores_previous_chaincode_package(self):
        self.old["chaincode"] = copy.deepcopy(self.state["chaincode"])
        self.controller.save_record(self.old)
        self.candidate["manifest"]["chaincode"] = "d" * 64
        promoted = dict(self.state, current=self.candidate["id"], previous=self.old["id"],
                        chaincode={"sequence": 2, "version": "cd-new", "packages": {"1": "new", "2": "new"}, "fingerprint": "d" * 64})
        atomic_json(self.base / "cd/state.json", promoted)
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        self.controller.definition = lambda: {"sequence": 2, "version": "cd-new"}
        restored = []

        def lifecycle(packages, version, sequence):
            restored.append((packages, sequence))
            return {"packages": packages, "version": version, "sequence": sequence}

        self.controller.lifecycle = lifecycle
        self.controller.restore_definition = Controller.restore_definition.__get__(self.controller)
        self.assertEqual(self.controller.recover()["result"], "recovered")
        state = self.controller.state()
        self.assertEqual(restored, [({"1": "old", "2": "old"}, 3)])
        self.assertEqual(state["current"], self.old["id"])
        self.assertEqual(state["previous"], self.candidate["id"])
        self.assertEqual(state["chaincode"]["fingerprint"], "c" * 64)
        self.assertEqual(state["chaincode"]["sequence"], 3)
        self.assertFalse((self.base / "cd/journal.json").exists())

    def test_deleted_or_changed_history_is_detected(self):
        for after in ({"fingerprints": {}, "counts": {"trace_event": 40}},
                      {"fingerprints": {"event": "mutated"}, "counts": {"trace_event": 40}},
                      {"fingerprints": {"event": "unchanged"}, "counts": {"trace_event": 39}}):
            with self.assertRaises(PolicyError):
                Controller.preserve(self.controller.data, after)


if __name__ == "__main__":
    unittest.main()
