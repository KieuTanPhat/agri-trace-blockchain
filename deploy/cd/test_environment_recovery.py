"""Regressions from the dev/production delivery review (AGT-031)."""
import copy
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_controller import Rehearsal, Controller, PolicyError, atomic_json, module
from test_targets import binding

spec = importlib.util.spec_from_file_location("environment_admin", Path(__file__).with_name("install-target.py"))
admin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(admin)


@unittest.skipIf(os.name == "nt", "Durable controller operations require Linux directory fsync")
class EnvironmentRecovery(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        (self.base / "cd").mkdir()
        (self.base / "backups").mkdir()
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=https://nongtrace.site\nPOSTGRES_USER=dev\nPOSTGRES_DB=dev\n")
        self.config = dict(binding(), base=str(self.base), env=str(env), accounts=str(self.base / "accounts.json"), enabled=True)
        with patch.object(module.policy.targets, "validate_config", return_value=self.config):
            self.controller = Rehearsal(self.config)
        self.old = {"id": "dev-" + "a" * 40, "sha": "a" * 40, "directory": str(self.base / "old"), "verified": True,
                    "manifest": {"format": 2, "chaincode": "c" * 64, "api": "api:old", "web": "web:old",
                                 "migrations": {"20260101_init": "a" * 64}}}
        self.candidate = dict(copy.deepcopy(self.old), id="dev-" + "b" * 40, sha="b" * 40,
                              directory=str(self.base / "new"), verified=False)
        self.controller.save_record(self.old)
        self.controller.save_record(self.candidate)
        self.state = {"current": self.old["id"], "chaincode": {"sequence": 0, "version": "disabled", "packages": {}, "fingerprint": "c" * 64},
                      "compatible_migrations": []}
        atomic_json(self.base / "cd/state.json", self.state)
        (self.base / "current").symlink_to(self.old["directory"])
        self.runtime = set()
        self.volume_owner = self.controller.project
        self.controller.run = self.run_command
        original_start = self.controller.start
        original_stop = self.controller.stop
        def start(record):
            self.runtime.update(("api", "web"))
            original_start(record)
        def stop(record):
            self.runtime.discard("api")
            original_stop(record)
        self.controller.start, self.controller.stop = start, stop

    def run_command(self, label, args, output=None, **kwargs):
        self.controller.calls.append((label, args))
        if label == "retained-dev-runtime":
            return "\n".join(sorted(self.runtime)).encode()
        if label == "retained-dev-volume":
            return json.dumps([{"Name": self.config["postgres_volume"], "Labels": {"com.docker.compose.project": self.volume_owner}}]).encode()
        if label == "retained-dev-postgres":
            self.runtime.add("postgres")
        if output:
            output.write(b"disposable database dump")
        for flag in ("-czf", "-cf", "-out"):
            if flag in args:
                Path(args[args.index(flag) + 1]).write_bytes(b"private fixture " + label.encode())
        if label == "ledger-volume-path":
            return ("/var/lib/docker/volumes/" + args[-1] + "/_data").encode()
        if label == "retained-fabric-container":
            return json.dumps([self.fabric_metadata]).encode()
        return b""

    def database_requires_running_postgres(self, record):
        if "postgres" not in self.runtime:
            raise PolicyError("database is stopped")
        return {"20260101_init": "a" * 64}

    def test_new_sha_deploy_resumes_retired_database_without_bootstrap_or_data_reset(self):
        self.controller.applied = self.database_requires_running_postgres
        result = self.controller.rollout(self.candidate, self.state)
        self.assertEqual(result["result"], "passed")
        self.assertEqual(self.controller.state()["current"], self.candidate["id"])
        labels = [call[0] if isinstance(call, tuple) else call for call in self.controller.calls]
        self.assertLess(labels.index("retained-dev-volume"), labels.index("retained-dev-postgres"))
        self.assertLess(labels.index("retained-dev-postgres"), labels.index("snapshot"))
        self.assertEqual(self.controller.data["fingerprints"], {"event": "unchanged"})
        self.assertFalse(any(word in str(self.controller.calls) for word in ("bootstrap", "down", "agri-trace-uat")))

    def test_healthy_new_sha_deploy_does_not_restart_the_old_application(self):
        self.runtime.update(("postgres", "api", "web"))
        self.controller.applied = self.database_requires_running_postgres
        self.controller.rollout(self.candidate, self.state)
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertFalse(any(isinstance(call, tuple) and call[0] == "retained-dev-postgres" for call in self.controller.calls))

    def test_retired_deploy_rejects_foreign_volume_before_start_or_migration(self):
        self.volume_owner = "agri-trace-uat"
        self.controller.applied = self.database_requires_running_postgres
        with self.assertRaisesRegex(PolicyError, "ownership"):
            self.controller.rollout(self.candidate, self.state)
        self.assertNotIn("migration-deploy", self.controller.calls)
        self.assertFalse(self.runtime)

    def test_invalid_candidate_cannot_resume_retired_runtime(self):
        def reject(record):
            raise PolicyError("candidate rejected")
        self.controller.preflight = reject
        with self.assertRaisesRegex(PolicyError, "candidate rejected"):
            self.controller.rollout(self.candidate, self.state)
        self.assertFalse(self.runtime)
        self.assertEqual(self.controller.calls, [])

    def test_failed_resumed_baseline_stops_writers_without_starting_migration(self):
        self.controller.applied = self.database_requires_running_postgres
        self.controller.verify = lambda *args: (_ for _ in ()).throw(PolicyError("baseline rejected"))
        with self.assertRaisesRegex(PolicyError, "baseline rejected"):
            self.controller.rollout(self.candidate, self.state)
        self.assertFalse(self.controller.writers_running)
        self.assertNotIn("api", self.runtime)
        self.assertNotIn("migration-deploy", self.controller.calls)

    def test_light_recovery_after_promotion_restores_the_previous_source_fingerprint(self):
        self.runtime.add("postgres")
        self.candidate["manifest"]["chaincode"] = "d" * 64
        self.controller.save_record(self.candidate)
        promoted = dict(self.state, current=self.candidate["id"], previous=self.old["id"],
                        chaincode=dict(self.state["chaincode"], fingerprint="d" * 64))
        atomic_json(self.controller.storage / "state.json", promoted)
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        self.controller.restore_definition = Controller.restore_definition.__get__(self.controller)
        self.controller.recover()
        self.assertEqual(self.controller.state()["current"], self.old["id"])
        self.assertEqual(self.controller.state()["chaincode"]["fingerprint"], "c" * 64)
        self.assertEqual(self.controller.data["fingerprints"], {"event": "unchanged"})

    def retained_fabric(self):
        root = self.base / "shared/fabric"
        root.mkdir(parents=True)
        self.controller.fabric = {"root": str(root), "network": "agritrace-dev-fabric", "channel": "agritrace-dev", "containers": ["agritrace-dev-peer1"],
                                  "volumes": ["agritrace-dev-ledger1"], "backup_paths": [str(root)]}
        self.config["fabric"] = self.controller.fabric
        self.fabric_metadata = {"State": {"Running": False, "Status": "exited"},
                                "NetworkSettings": {"Networks": {"agritrace-dev-fabric": {}}},
                                "Mounts": [{"Type": "volume", "Name": "agritrace-dev-ledger1"}, {"Type": "bind", "Source": str(root)}]}

    def test_light_recovery_cannot_ignore_a_retained_ledger_fingerprint_mismatch(self):
        self.retained_fabric()
        changed = dict(self.state, chaincode=dict(self.state["chaincode"], fingerprint="d" * 64))
        with self.assertRaisesRegex(PolicyError, "Retained"):
            Controller.restore_definition(self.controller, changed, self.old)

    def test_light_backup_includes_retained_ledger_and_identity_without_starting_fabric(self):
        self.retained_fabric()
        directory = Path(Controller.target_snapshot(self.controller, self.old, self.candidate["sha"], self.controller.data))
        checksums = json.loads((directory / "checksums.json").read_text())
        self.assertIn("fabric-ledger.tar.gz", checksums)
        self.assertIn("fabric-identities.tar.gz", checksums)
        self.assertTrue((directory / "snapshot.cms").exists())
        self.assertFalse(any(isinstance(call, tuple) and call[1][:2] in (["docker", "start"], ["docker", "stop"]) for call in self.controller.calls))
        self.assertNotIn("agri-trace-uat", str(self.controller.calls))

    def test_light_backup_rejects_running_fabric_before_archiving_ledger(self):
        self.retained_fabric()
        self.fabric_metadata["State"]["Running"] = True
        with self.assertRaisesRegex(PolicyError, "stopped"):
            Controller.target_snapshot(self.controller, self.old, self.candidate["sha"], self.controller.data)
        self.assertFalse((self.controller.storage / "backups.json").exists())

    def test_light_backup_rejects_foreign_fabric_mount(self):
        self.retained_fabric()
        self.fabric_metadata["Mounts"][1]["Source"] = "/opt/agri-trace/shared/fabric"
        with self.assertRaisesRegex(PolicyError, "outside dev"):
            Controller.target_snapshot(self.controller, self.old, self.candidate["sha"], self.controller.data)
        self.assertFalse((self.controller.storage / "backups.json").exists())

    def test_runtime_failure_after_start_stops_both_writers_and_keeps_marker(self):
        self.check_runtime_failure(fail_initial_stop=False)

    def test_runtime_fabric_off_failure_stops_api_and_keeps_marker(self):
        self.check_runtime_failure(fail_initial_stop=False, operation="fabric-off")

    def test_runtime_initial_stop_failure_also_cleans_up_both_writers(self):
        self.check_runtime_failure(fail_initial_stop=True)

    def test_failed_cleanup_is_reported_and_does_not_remove_the_transition_marker(self):
        self.check_runtime_failure(fail_initial_stop=False, fail_cleanup=True)

    def check_runtime_failure(self, fail_initial_stop, operation="fabric-on", fail_cleanup=False):
        self.retained_fabric()
        self.config["fabric_enabled"] = operation == "fabric-off"
        self.state["chaincode"].update(sequence=1, version="test")
        writers = {"api", "worker"}
        calls = []
        class Runtime:
            def __init__(runtime, config):
                runtime.storage = self.controller.storage
                runtime.fabric_active = config.get("fabric_enabled", False)
            def state(runtime):
                return self.state
            def record(runtime, release):
                return self.old
            def run(runtime, label, args, **kwargs):
                calls.append((label, args))
                if label == "dev-fabric-ownership":
                    return json.dumps([self.fabric_metadata]).encode()
                if label == "dev-running-writers":
                    return "\n".join(("a" if name == "api" else "b") * 12 + " " + name for name in sorted(writers)).encode()
                if label == "dev-writers-stop-after-failure":
                    if fail_cleanup:
                        raise admin.policy.PolicyError("Docker stop failed")
                    writers.clear()
                return b""
            def stop(runtime, record):
                if fail_initial_stop:
                    raise admin.policy.PolicyError("initial stop failed")
                writers.clear()
            def resume_fabric(runtime):
                calls.append(("resume", []))
            def definition(runtime):
                return {"sequence": 1, "version": "test"}
            def preflight(runtime, record):
                pass
            def start(runtime, record):
                writers.update(("api", "worker") if runtime.fabric_active else ("api",))
            def verify(runtime, *args):
                raise admin.policy.PolicyError("verification interrupted")
        config_file = self.base / "installed-config.json"
        original_read = Path.read_text
        def read_text(path, *args, **kwargs):
            return "MemAvailable: 99999999 kB\n" if str(path) == "/proc/meminfo" else original_read(path, *args, **kwargs)
        with patch.object(admin, "Controller", Runtime), patch.object(admin, "config_path", return_value=config_file), patch.object(Path, "read_text", read_text):
            with self.assertRaisesRegex(admin.policy.PolicyError, "reconcile cleanup: writers" if fail_cleanup else "initial stop failed|verification interrupted"):
                admin.fabric_runtime("development", operation, self.config)
        if not fail_cleanup:
            self.assertFalse(writers, "API and Worker must remain stopped during an unresolved transition")
        self.assertTrue((self.controller.storage / "runtime-toggle.json").exists())
        self.assertFalse(json.loads(config_file.read_text())["fabric_enabled"])
        self.assertTrue(any(label == "dev-fabric-stop-after-failure" for label, _ in calls))
        self.assertNotIn("agri-trace-uat", str(calls))


if __name__ == "__main__":
    unittest.main()
