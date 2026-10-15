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
from cd_testing import build, hosted_config

SHA_B = "b" * 40


class DomainDelivery(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=https://agritrace.dev\n"
                       "CORS_ORIGINS=https://agritrace.dev,https://www.agritrace.dev\n")
        (self.base / "accounts.json").write_text("[]")
        self.controller = build(Controller, hosted_config(self.base, env))
        self.record = {"id": "prod-" + SHA_B, "directory": str(self.base / "new"),
                       "manifest": {"origin": "https://agritrace.dev", "api": "api:new", "web": "web:new", "migrations": {}, "files": {}}}

    def environment(self, record):
        return module.policy.read_env(self.base / "cd/records" / record["id"] / "origin.env")

    def test_release_environment_pins_origin_images_network_and_closed_writers(self):
        command = self.controller.dc(self.record, "config")
        values = self.environment(self.record)
        self.assertEqual(values["PUBLIC_ORIGIN"], "https://agritrace.dev")
        self.assertEqual(values["CORS_ORIGINS"], "https://agritrace.dev,https://www.agritrace.dev")
        self.assertEqual((values["API_IMAGE"], values["WEB_IMAGE"]), ("api:new", "web:new"))
        self.assertEqual((values["DEPLOY_ENV"], values["UPSTREAM_PREFIX"]), ("production", "prod"))
        self.assertEqual(values["INGRESS_NETWORK"], "agritrace-prod-ingress")
        self.assertEqual(values["POSTGRES_VOLUME"], "agritrace-prod_postgres-data")
        self.assertEqual(values["FABRIC_DOCKER_NETWORK"], "hosted_test")
        self.assertEqual((values["HYBRID_WRITES_MODE"], values["FABRIC_LEGACY_WRITER"]), ("CLOSED", "false"))
        self.assertEqual(command.count("--env-file"), 2)
        self.assertEqual(command[command.index("--profile") + 1], "fabric")
        self.assertTrue(any(value.endswith("docker-compose.app.yml") for value in command))
        self.assertFalse(any("uat" in value for value in command), "Retired UAT compose files must never be selected")

    def test_a_verified_release_opens_writers_only_when_the_installed_policy_says_so(self):
        for configured, verified, expected in (({}, True, "CLOSED"), ({"open_after_smoke": True}, True, "OPEN"),
                                               ({"open_after_smoke": True}, False, "CLOSED"), ({"writes_mode": "OPEN"}, True, "OPEN")):
            with self.subTest(configured=configured, verified=verified):
                self.controller.config.pop("open_after_smoke", None)
                self.controller.config.pop("writes_mode", None)
                self.controller.config.update(configured)
                record = dict(self.record, verified=verified)
                self.controller.write_release_environment(record)
                self.assertEqual(self.environment(record)["HYBRID_WRITES_MODE"], expected)

    def test_hybrid_release_adds_the_connection_overlay_and_requires_it_in_the_manifest(self):
        hybrid = dict(self.record, manifest=dict(self.record["manifest"], migrations={"20261014000000_hybrid_chain_scope": "d" * 64}))
        with self.assertRaisesRegex(PolicyError, "connection overlay"):
            self.controller.dc(hybrid, "config")
        hybrid["manifest"]["files"] = {"docker-compose.app-hybrid.yml": "e" * 64}
        command = self.controller.dc(hybrid, "config")
        self.assertTrue(any(value.endswith("docker-compose.app-hybrid.yml") for value in command))

    def test_reviewed_resource_profile_is_bounded(self):
        self.controller.config["resource_profile"] = {"API": 1024, "POSTGRES": 512}
        self.controller.write_release_environment(self.record)
        values = self.environment(self.record)
        self.assertEqual((values["API_MEMORY"], values["API_HEAP_MB"], values["POSTGRES_MEMORY"]), ("1024m", "896", "512m"))
        for value in (64, 8192, "512", True):
            with self.subTest(value=value):
                self.controller.config["resource_profile"] = {"WEB": value}
                with self.assertRaisesRegex(PolicyError, "resource profile"):
                    self.controller.write_release_environment(self.record)

    def test_verification_is_always_the_hosted_verifier_and_requests_writes_only_for_a_candidate(self):
        self.controller.verify_hosted = MagicMock(return_value={"result": "passed"})
        self.controller.verify(self.record)
        self.controller.verify_hosted.assert_called_with(self.record, False)
        self.controller.verify(self.record, SHA_B)
        self.controller.verify_hosted.assert_called_with(self.record, True)

    def test_enterprise_inventory_is_private_and_admission_agrees_between_api_and_worker(self):
        directory = self.base / 'shared/worker'
        inventory = directory / 'enterprise-connections.json'
        directory.mkdir(parents=True)
        (directory / 'bindings.json').write_text('{}')
        inventory.write_text('{"version":1,"targets":[]}')
        inventory.chmod(0o600)
        self.controller.environment['HOSTED_WORKER_CONFIG_HOST'] = str(directory)
        self.controller.environment['FABRIC_BINDINGS_CONFIG_HOST'] = str(directory / 'bindings.json')
        self.controller.environment['ENTERPRISE_CONNECTIONS_CONFIG_HOST'] = str(inventory)
        api = {'ENTERPRISE_ONBOARDING_ENABLED': 'false'}
        worker = {'environment': {'ENTERPRISE_ONBOARDING_ENABLED': 'false',
                                 'ENTERPRISE_CONNECTIONS_CONFIG': '/hosted-config/enterprise-connections.json'}}
        self.controller.enterprise_admission_preflight(api, worker)
        worker['environment']['ENTERPRISE_ONBOARDING_ENABLED'] = 'true'
        with self.assertRaisesRegex(PolicyError, 'API/Worker enterprise admission'):
            self.controller.enterprise_admission_preflight(api, worker)
        worker['environment']['ENTERPRISE_ONBOARDING_ENABLED'] = 'false'
        self.controller.environment['HOSTED_WORKER_CONFIG_HOST'] = str(self.base / 'outside')
        with self.assertRaisesRegex(PolicyError, 'private production'):
            self.controller.enterprise_admission_preflight(api, worker)
        self.controller.environment['HOSTED_WORKER_CONFIG_HOST'] = str(directory)
        self.controller.environment['ENTERPRISE_CONNECTIONS_CONFIG_HOST'] = str(inventory)
        inventory.chmod(0o666)
        with self.assertRaisesRegex(PolicyError, 'writable'):
            self.controller.enterprise_admission_preflight(api, worker)

    def test_resume_fabric_waits_for_both_peers_before_reconcile(self):
        self.controller.run = MagicMock(return_value=b"")
        self.controller.definition = MagicMock(side_effect=[PolicyError("peer unavailable"), {"sequence": 2}])
        with patch.object(module.time, "monotonic", side_effect=[0, 1, 2]), \
                patch.object(module.time, "sleep") as sleep:
            self.controller.resume_fabric()
        self.assertEqual(self.controller.run.call_args.args[1], ["docker", "start", "peer-a", "peer-b", "orderer-a"])
        self.assertEqual(self.controller.definition.call_count, 2)
        sleep.assert_called_once_with(5)

    def test_resume_fabric_times_out_without_starting_application(self):
        self.controller.run = MagicMock(return_value=b"")
        self.controller.definition = MagicMock(side_effect=PolicyError("peer unavailable"))
        with patch.object(module.time, "monotonic", side_effect=[0, 1, 181]), \
                patch.object(module.time, "sleep"):
            with self.assertRaisesRegex(PolicyError, "Fabric peers"):
                self.controller.resume_fabric()
        self.assertEqual(self.controller.phase, "fabric-readiness")
        self.assertEqual(self.controller.run.call_count, 1)

    def test_snapshot_resume_does_not_overwrite_the_original_failure_phase(self):
        (self.base / "backups").mkdir()
        self.controller.environment.update(POSTGRES_USER="test", POSTGRES_DB="test")
        self.controller.dc = MagicMock(return_value=["docker", "compose"])

        def run(label, arguments, **kwargs):
            self.controller.phase = label
            if label == "ledger-volume-path":
                return f"/var/lib/docker/volumes/{arguments[-1]}/_data".encode()
            if label == "ledger-consistent-backup":
                raise PolicyError("simulated ledger backup failure")
            return b""

        self.controller.run = run
        self.controller.resume_fabric = MagicMock(side_effect=lambda: setattr(self.controller, "phase", "fabric-readiness"))
        with patch.object(module, "atomic_json"), self.assertRaisesRegex(PolicyError, "ledger backup"):
            self.controller.snapshot(self.record, "c" * 40, {})
        self.controller.resume_fabric.assert_called_once()
        self.assertEqual(self.controller.phase, "ledger-consistent-backup")

    def test_external_backup_requires_original_candidate_frozen_rows_and_same_remote_block(self):
        directory = self.base / 'shared'
        directory.mkdir()
        filename = directory / 'coordinated-backup.json'
        self.controller.fabric['external_owner'] = {'msp_id': 'Org3MSP', 'channel': 'hybrid-self',
            'hostname': 'peer0.org3.example.com', 'endpoint': '10.77.0.2:11051', 'tls_ca': '/public/owner.crt'}
        self.controller.config['external_backup_receipt'] = str(filename)
        baseline = {'writersStopped': True, 'fingerprints': {'event:one': 'unchanged'}}
        ledger = {'height': 25, 'currentBlockHash': 'same', 'previousBlockHash': 'previous'}
        receipt = {'protocol': 'agritrace-coordinated-backup/1', 'candidateSha': SHA_B, 'ownerMspId': 'Org3MSP',
                   'ownerArchiveSha256': 'a' * 64, 'ownerArchiveBytes': 1000, 'offVps': True, 'ledger': ledger,
                   'fingerprintsSha256': module.policy.sha256(json.dumps(baseline['fingerprints'], sort_keys=True, separators=(',', ':')).encode())}
        self.controller.peer_env = MagicMock(return_value=('/peer', {}))
        self.controller.run = MagicMock(return_value=('Blockchain info: ' + json.dumps(ledger)).encode())
        filename.write_text(json.dumps(receipt))
        self.controller.external_backup_preflight(SHA_B, baseline)
        with self.assertRaisesRegex(PolicyError, 'candidate'):
            self.controller.external_backup_preflight('c' * 40, baseline)
        with self.assertRaisesRegex(PolicyError, 'frozen'):
            self.controller.external_backup_preflight(SHA_B, dict(baseline, fingerprints={}))
        self.controller.run.return_value = json.dumps(dict(ledger, height=26)).encode()
        with self.assertRaisesRegex(PolicyError, 'advanced'):
            self.controller.external_backup_preflight(SHA_B, baseline)

    def test_snapshot_catalogs_hosted_ledger_and_private_state_only(self):
        (self.base / "backups").mkdir()
        self.controller.environment.update(POSTGRES_USER="test", POSTGRES_DB="test")
        self.controller.dc = MagicMock(return_value=["docker", "compose"])
        self.controller.resume_fabric = MagicMock()
        calls = {}

        def run(label, arguments, **kwargs):
            calls[label] = arguments
            if label == "ledger-volume-path":
                return f"/var/lib/docker/volumes/{arguments[-1]}/_data".encode()
            if label in {"ledger-consistent-backup", "private-identity-backup", "private-config-backup"}:
                Path(next(item for item in arguments if item.endswith(".tar.gz"))).write_bytes(b"archive")
            if label == "snapshot-bundle":
                Path(arguments[arguments.index("-cf") + 1]).write_bytes(b"bundle")
            return b""

        self.controller.run = run
        directory = Path(self.controller.snapshot(self.record, "c" * 40, {}))
        self.assertEqual(calls["fabric-stop-for-snapshot"][-3:], ["peer-a", "peer-b", "orderer-a"])
        self.assertEqual([item for item in calls["ledger-consistent-backup"] if item.endswith("/_data")], ["ledger-a/_data", "ledger-b/_data"])
        private = calls["private-config-backup"]
        self.assertIn(str((self.base / "shared").relative_to("/")), private)
        self.assertIn("etc/agri-trace-cd/prod", private)
        self.assertIn(str(Path(module.__file__).resolve().parent.relative_to('/')), private,
                      'The immutable helper generation must be archived as well as its selection symlink')
        self.assertFalse(any("uat" in item for item in private))
        self.assertTrue(directory.name.startswith("prod-" + "c" * 40))
        self.assertFalse((directory / "snapshot.tar").exists(), "The unencrypted bundle must be removed after encryption")
        self.assertEqual(json.loads((self.base / "cd/backups.json").read_text()), {"c" * 40: str(directory)})
        self.controller.resume_fabric.assert_called_once()

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
                self.controller.start(self.record)
        self.assertEqual(self.controller.phase, "public-https-readiness")
        self.assertEqual([call.args[0] for call in request.call_args_list],
                         ["https://agritrace.dev/login", "https://www.agritrace.dev/login"])

    def test_both_https_routes_must_succeed_before_returning_ready(self):
        self.controller.run = MagicMock(return_value=b"")
        with patch.object(module.time, "monotonic", side_effect=[0, 1, 2]), \
                patch.object(module.time, "sleep") as sleep, \
                patch.object(module.urllib.request, "urlopen",
                             side_effect=[self.response(), OSError("not yet ready"), self.response(), self.response()]) as request:
            self.controller.start(self.record)
        self.assertEqual(request.call_count, 4)
        sleep.assert_called_once_with(5)

    def test_application_start_never_touches_the_shared_edge_proxy(self):
        self.controller.run = MagicMock(return_value=b"")
        self.controller.dc = MagicMock(return_value=["docker", "compose"])
        with patch.object(module.urllib.request, "urlopen", return_value=self.response()):
            self.controller.start(self.record)
        services = [call.args for call in self.controller.dc.call_args_list]
        self.assertTrue(all("proxy" not in args for args in services))

    def test_preflight_blocks_a_release_pinned_to_helpers_this_installation_does_not_ship(self):
        record = dict(self.record, manifest=dict(self.record["manifest"], controller={"verify.mjs": "0" * 64}))
        with patch.object(module.shutil, "disk_usage", return_value=MagicMock(free=64 * 1024 ** 3)):
            with self.assertRaisesRegex(PolicyError, "administrator must install the reviewed version"):
                self.controller.preflight(record)
        record["manifest"]["controller"] = {"policy.py": "0" * 64}
        with patch.object(module.shutil, "disk_usage", return_value=MagicMock(free=64 * 1024 ** 3)):
            with self.assertRaisesRegex(PolicyError, "administrator must install the reviewed version"):
                self.controller.preflight(record)

    def test_retired_uat_releases_and_configs_are_rejected(self):
        with self.assertRaisesRegex(PolicyError, "Unknown release"):
            self.controller.record("uat-" + SHA_B)
        env = self.base / ".env"
        for change in ({"schema": 2}, {"schema": None}):
            with self.subTest(change=change), self.assertRaisesRegex(PolicyError, "Unsupported installed config schema"):
                Controller(dict(hosted_config(self.base, env), **change))
        with self.assertRaisesRegex(PolicyError, "Unsupported installed config schema"):
            Controller({"base": str(self.base), "env": str(env)})


class CapacityAdmission(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.cd = Controller.__new__(Controller)
        self.cd.project = "agritrace-prod"
        self.cd.storage = Path(temporary.name)
        self.mib = 1024 * 1024
        self.runtime = [
            {"Name": "/hosted", "Config": {"Labels": {}},
             "HostConfig": {"Memory": 2944 * self.mib, "NanoCpus": 1_000_000_000}},
            {"Name": "/retained", "Config": {"Labels": {}},
             "HostConfig": {"Memory": 1024 * self.mib, "NanoCpus": 1_000_000_000}},
        ]
        self.cd.run = MagicMock(side_effect=lambda label, *args: b"hosted retained" if label == "capacity-runtime-catalog"
                                else json.dumps(self.runtime).encode())
        self.services = {name: {"cpus": cpu, "mem_limit": str(memory * self.mib)} for name, cpu, memory in
                         [("api", 1, 512), ("postgres", 1, 512), ("web", 1, 512), ("worker", .5, 384)]}

    def admit(self):
        with patch.object(module.Path, "read_text", return_value="MemTotal: 8131584 kB\n"):
            self.cd.capacity_preflight(self.services)

    def test_compose_decimal_byte_strings_and_integer_limits_share_the_full_host_budget(self):
        self.services["web"]["mem_limit"] = 512 * self.mib
        self.admit()
        receipt = json.loads((self.cd.storage / "capacity-admission.json").read_text())
        self.assertEqual(receipt["containerBytes"], 6272 * self.mib)
        self.assertEqual(receipt["reservedBytes"], (7941 - 6272) * self.mib)
        self.assertEqual(receipt["minimumReservePercent"], 20)

    def test_invalid_or_unbounded_compose_quantities_are_rejected(self):
        for value in (None, 0, -1, True, 1.5, "0", "-1", "512m", "1.0", " 123", "١٢"):
            with self.subTest(value=value):
                self.services["api"]["mem_limit"] = value
                with self.assertRaisesRegex(PolicyError, "positive memory quota"):
                    self.admit()

    def test_decimal_string_does_not_bypass_twenty_percent_reserve(self):
        self.services["api"]["mem_limit"] = str(1024 * self.mib)
        with self.assertRaisesRegex(PolicyError, "reserved host capacity"):
            self.admit()

    def test_unbounded_retained_container_still_blocks_bounded_candidate(self):
        self.runtime[0]["HostConfig"]["Memory"] = 0
        with self.assertRaisesRegex(PolicyError, "positive memory quota"):
            self.admit()


class Rehearsal(Controller):
    def __init__(self, config):
        super().__init__(config)
        self.calls = []
        self.fail_candidate = False
        self.fail_rollback = False
        self.fail_snapshot = False
        self.writers_running = True
        self.data = {"result": "passed", "counts": {"trace_event": 40}, "fingerprints": {"event": "unchanged"}, "canary": None}

    def preflight(self, record):
        self.calls.append("preflight")

    def admit_fresh_release(self, record, state):
        self.calls.append("admit")

    def applied(self, record):
        return {"20260101_init": "a" * 64}

    def verify(self, record, canary=None):
        self.calls.append("verify-" + record["id"])
        if self.fail_candidate and record["id"].endswith("b" * 40):
            self.phase = "release-verification"
            raise PolicyError("simulated candidate failure")
        if self.fail_rollback and record["id"].endswith("a" * 40):
            # Only fail rollback after a candidate was started, not the baseline check.
            if "start-prod-" + "b" * 40 in self.calls:
                raise PolicyError("simulated old health failure")
        result = copy.deepcopy(self.data)
        result["canary"] = canary
        return result

    def stop(self, record):
        self.calls.append("stop-" + record["id"])
        self.phase = "stop-writers"
        self.writers_running = False

    def start(self, record):
        self.calls.append("start-" + record["id"])
        self.writers_running = True

    def snapshot(self, old, attempt, baseline):
        self.calls.append("snapshot")
        if self.fail_snapshot:
            self.phase = "encrypted-offsite-backup"
            raise PolicyError("simulated backup failure")
        return "private-backup"

    def quiescent_baseline(self, record, observed):
        self.calls.append("quiescent-baseline")
        assert not self.writers_running
        return dict(observed, writersStopped=True)

    def run(self, label, args, **kwargs):
        self.calls.append(label)
        return b""

    def restore_definition(self, state, previous):
        self.calls.append("reconcile-definition")
        return state["chaincode"]

    def resume_fabric(self):
        self.calls.append("resume-fabric")


@unittest.skipIf(os.name == "nt", "Controller uses Linux durable directory fsync; policy tests remain portable")
class DeliveryFailureRecovery(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        (self.base / "cd").mkdir()
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=https://agritrace.dev\nCORS_ORIGINS=https://agritrace.dev,https://www.agritrace.dev\n")
        self.controller = build(Rehearsal, hosted_config(self.base, env))
        self.old = {"id": "prod-" + "a" * 40, "sha": "a" * 40, "directory": str(self.base / "old"), "verified": True,
                    "manifest": {"chaincode": "c" * 64, "api": "api:old", "web": "web:old", "files": {}, "migrations": {"20260101_init": "a" * 64}}}
        self.candidate = dict(copy.deepcopy(self.old), id="prod-" + "b" * 40, sha="b" * 40, directory=str(self.base / "new"), verified=False)
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
        self.assertEqual(self.controller.record(self.candidate["id"])["sessionContract"], "family-v1")

    def test_snapshot_baseline_is_captured_after_writer_stop(self):
        self.controller.rollout(self.candidate, self.state)
        self.assertLess(self.controller.calls.index("stop-" + self.old["id"]), self.controller.calls.index("quiescent-baseline"))
        self.assertLess(self.controller.calls.index("quiescent-baseline"), self.controller.calls.index("snapshot"))

    def test_hybrid_floor_blocks_recovery_before_old_app_or_lifecycle(self):
        floor = {"20261014000000_hybrid_chain_scope": "d" * 64}
        self.state["compatible_migrations"] = list(floor)
        atomic_json(self.base / "cd/state.json", self.state)
        atomic_json(self.base / "cd/hybrid-floor.json", {"protocol": "hybrid-abc/1", "migrations": floor})
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        with self.assertRaisesRegex(PolicyError, "Hybrid migration floor"):
            self.controller.recover()
        self.assertNotIn("reconcile-definition", self.controller.calls)
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertFalse(self.controller.writers_running)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_fix_forward_without_manifest_approval_keeps_journal_and_writers_stopped(self):
        self.controller.stop(self.old)
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        with self.assertRaisesRegex(PolicyError, "exact manifest approval"):
            self.controller.forward(self.candidate, self.state)
        self.assertFalse(self.controller.writers_running)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_fix_forward_preserves_failure_journal_and_never_restores_the_previous_definition(self):
        self.controller.stop(self.old)
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        digest = module.policy.sha256(json.dumps(self.candidate["manifest"], sort_keys=True, separators=(",", ":")).encode())
        self.controller.config["forward_recovery"] = {"sha": self.candidate["sha"], "manifest_sha256": digest}
        self.assertEqual(self.controller.forward(self.candidate, self.state)["result"], "forward-verified")
        self.assertNotIn("reconcile-definition", self.controller.calls)
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        archived = self.base / "cd/records" / self.candidate["id"] / "recovered-journal.json"
        self.assertEqual(json.loads(archived.read_text())["previous"], self.old["id"])

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

    def test_partial_migration_failure_keeps_writers_stopped_for_reconciliation(self):
        def migrate(record):
            self.controller.calls.append("migration-deploy")
            raise PolicyError("simulated partial migration failure")

        def applied(record):
            if "migration-deploy" in self.controller.calls:
                raise PolicyError("unfinished migration")
            return {"20260101_init": "a" * 64}

        self.controller.migrate = migrate
        self.controller.applied = applied
        with self.assertRaisesRegex(PolicyError, "recovery-required"):
            self.controller.rollout(self.candidate, self.state)
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_failed_rollback_leaves_recoverable_journal(self):
        self.controller.fail_candidate = self.controller.fail_rollback = True
        with self.assertRaisesRegex(PolicyError, "recovery-required"):
            self.controller.rollout(self.candidate, self.state)
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.assertFalse(self.controller.writers_running)
        self.controller.fail_candidate = self.controller.fail_rollback = False
        self.assertEqual(self.controller.recover()["result"], "recovered")
        self.assertFalse((self.base / "cd/journal.json").exists())

    def test_failed_automatic_rollback_stops_partially_started_writers(self):
        self.controller.fail_candidate = True
        original_start = self.controller.start

        def start(record):
            original_start(record)
            if record["id"] == self.old["id"]:
                self.controller.phase = "worker-readiness"
                raise PolicyError("Worker failed after API started")

        self.controller.start = start
        with self.assertRaisesRegex(PolicyError, "recovery-required"):
            self.controller.rollout(self.candidate, self.state)
        self.assertFalse(self.controller.writers_running)
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.assertEqual(self.controller.state()["current"], self.old["id"])

    def test_recover_rejected_history_stops_writers_again(self):
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        self.controller.data["fingerprints"] = {}
        with self.assertRaisesRegex(PolicyError, "history changed"):
            self.controller.recover()
        self.assertFalse(self.controller.writers_running)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_recover_stops_writers_after_readiness_verification_or_promotion_failure(self):
        for method in ("start", "verify", "switch"):
            with self.subTest(method=method):
                self.controller.journal(self.old, self.candidate, "application", self.controller.data)
                original = getattr(self.controller, method)

                def fail(*args):
                    if method == "start":
                        original(*args)
                    self.controller.phase = "simulated-" + method
                    raise PolicyError("simulated recovery failure")

                with patch.object(self.controller, method, side_effect=fail):
                    with self.assertRaisesRegex(PolicyError, "simulated recovery failure"):
                        self.controller.recover()
                self.assertFalse(self.controller.writers_running)
                self.assertEqual(self.controller.phase, "simulated-" + method)
                self.assertTrue((self.base / "cd/journal.json").exists())
                self.assertEqual(self.controller.state()["current"], self.old["id"])

    def test_failed_manual_rollback_stops_the_unverified_target(self):
        self.candidate["verified"] = True
        self.controller.save_record(self.candidate)
        self.controller.fail_candidate = True
        with self.assertRaisesRegex(PolicyError, "run recover"):
            self.controller.execute(["rollback", self.candidate["sha"]], MagicMock())
        self.assertFalse(self.controller.writers_running)
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.assertEqual(self.controller.state()["current"], self.old["id"])

    def test_failed_manual_rollback_stops_partially_started_writers(self):
        self.candidate["verified"] = True
        self.controller.save_record(self.candidate)
        original_start = self.controller.start

        def start(record):
            original_start(record)
            self.controller.phase = "worker-readiness"
            raise PolicyError("Worker failed after API started")

        self.controller.start = start
        with self.assertRaisesRegex(PolicyError, "run recover"):
            self.controller.execute(["rollback", self.candidate["sha"]], MagicMock())
        self.assertFalse(self.controller.writers_running)
        self.assertEqual(self.controller.phase, "worker-readiness")
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_failed_stop_after_recovery_failure_keeps_the_journal_and_reports_failure(self):
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        self.controller.verify = MagicMock(side_effect=PolicyError("recovery verification failed"))
        original_stop = self.controller.stop

        def stop(record):
            if record["id"] == self.old["id"]:
                raise PolicyError("Docker could not confirm writers stopped")
            original_stop(record)

        self.controller.stop = stop
        with self.assertRaisesRegex(PolicyError, "could not confirm writers stopped"):
            self.controller.recover()
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.assertEqual(self.controller.state()["current"], self.old["id"])

    def test_pending_journal_blocks_deploy_and_upgrade_even_for_the_current_sha(self):
        self.controller.journal(self.old, self.candidate, "application", self.controller.data)
        for operation in ("deploy", "upgrade"):
            for current in (self.old, self.candidate):
                atomic_json(self.base / "cd/state.json", dict(self.state, current=current["id"]))
                with self.subTest(operation=operation, current=current["id"]):
                    stream = MagicMock()
                    parts = [operation, current["sha"], "d" * 64]
                    if operation == "upgrade":
                        parts.append("1")
                    with self.assertRaisesRegex(PolicyError, "recover"):
                        self.controller.execute(parts, stream)
                    stream.readline.assert_not_called()
                    self.assertEqual(self.controller.calls, [])
                    self.assertTrue((self.base / "cd/journal.json").exists())

    def test_recover_resumes_fabric_left_stopped_by_interrupted_snapshot(self):
        self.controller.journal(self.old, self.candidate, "snapshot", self.controller.data)

        def reconcile(state, previous):
            if "resume-fabric" not in self.controller.calls:
                raise PolicyError("Fabric is still stopped after an interrupted snapshot")
            self.controller.calls.append("reconcile-definition")
            return state["chaincode"]

        self.controller.restore_definition = reconcile
        self.assertEqual(self.controller.recover()["result"], "recovered")
        calls = self.controller.calls
        self.assertLess(calls.index("stop-" + self.candidate["id"]), calls.index("resume-fabric"))
        self.assertLess(calls.index("resume-fabric"), calls.index("reconcile-definition"))
        self.assertLess(calls.index("reconcile-definition"), calls.index("start-" + self.old["id"]))

    def test_recover_does_not_open_writers_before_migration_reconciliation(self):
        self.controller.journal(self.old, self.candidate, "migration", self.controller.data)
        self.controller.applied = MagicMock(side_effect=PolicyError("unfinished migration"))
        with self.assertRaisesRegex(PolicyError, "unfinished migration"):
            self.controller.recover()
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_recover_validates_additive_migration_bytes_and_line_ending_variants(self):
        name = "20260102_note"
        script = b'ALTER TABLE "lot" ADD COLUMN "memo" TEXT;\r\n'
        filename = Path(self.candidate["directory"]) / "apps/api/prisma/migrations" / name / "migration.sql"
        filename.parent.mkdir(parents=True)
        filename.write_bytes(script)
        self.candidate["manifest"]["migrations"][name] = module.policy.sha256(script)
        self.controller.save_record(self.candidate)
        self.controller.applied = MagicMock(return_value={"20260101_init": "a" * 64, name: module.policy.sha256(script.replace(b"\r\n", b"\n"))})
        self.controller.journal(self.old, self.candidate, "migration", self.controller.data)
        self.assertEqual(self.controller.recover()["result"], "recovered")
        self.assertEqual(self.controller.state()["compatible_migrations"], [name])

    def test_recover_rejects_unknown_completed_migration_before_starting_writers(self):
        self.controller.applied = MagicMock(return_value={"20260101_init": "a" * 64, "20260102_unknown": "d" * 64})
        self.controller.journal(self.old, self.candidate, "migration", self.controller.data)
        with self.assertRaises(PolicyError):
            self.controller.recover()
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertTrue((self.base / "cd/journal.json").exists())

    def test_result_write_failure_keeps_journal_if_rollback_also_fails(self):
        self.controller.fail_rollback = True

        def persist(filename, data):
            if Path(filename).name == "last-result.json" and data.get("result") == "passed":
                raise OSError("simulated persistence failure after promotion")
            return atomic_json(filename, data)

        with patch.object(module, "atomic_json", side_effect=persist):
            with self.assertRaisesRegex(PolicyError, "recovery-required"):
                self.controller.rollout(self.candidate, self.state)
        self.assertTrue((self.base / "cd/journal.json").exists())
        self.controller.fail_rollback = False
        self.assertEqual(self.controller.recover()["result"], "recovered")
        self.assertEqual(self.controller.state()["current"], self.old["id"])

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
