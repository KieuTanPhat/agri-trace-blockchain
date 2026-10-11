import copy
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from policy import CONTROLLER_FILES, PolicyError, ci_gate, extract, fingerprint, require, sha256, targets
from controller import Controller, PolicyError as ControllerError, policy as controller_policy


def binding(environment="development"):
    selected = targets.TARGETS[environment]
    base = "/opt/agri-trace-dev" if environment == "development" else "/opt/agri-trace"
    return dict(selected, schema=2, environment=environment, enabled=False,
                profile="light" if environment == "development" else "fabric", base=base,
                ingress=selected["ingress"], postgres_volume=selected["project"] + "_postgres-data",
                repository="KieuTanPhat/agri-trace-blockchain", host_lock="/run/lock/agri-trace-host.lock",
                env=base + "/shared/config/.env", accounts=base + "/shared/config/accounts.json",
                backup_certificate=base + "/shared/config/backup.pem",
                canary={"farmId": "6bb639b5-924a-4e82-8d80-000000000201", "plotId": "6bb639b5-924a-4e82-8d80-000000000203", "productId": "6bb639b5-924a-4e82-8d80-000000000202"})


class TargetPolicy(unittest.TestCase):
    def test_dev_rejects_every_production_resource_binding(self):
        valid = binding()
        targets.validate_config(valid, require)
        for key, value in {"branch": "main", "origin": "https://agritrace.dev", "base": "/opt/agri-trace",
                           "project": "agri-trace-uat", "postgres_volume": "agri-trace-uat_postgres-data",
                           "ingress": "agritrace-prod-ingress", "env": "/opt/agri-trace/shared/config/.env",
                           "enabled": "true", "schema": 1, "host_lock": "/tmp/lock",
                           "accounts": "/opt/agri-trace-dev/shared/../../agri-trace/shared/accounts.json"}.items():
            with self.subTest(key=key), self.assertRaises(PolicyError):
                targets.validate_config(dict(valid, **{key: value}), require)

    def test_fabric_cannot_be_enabled_without_a_separate_binding(self):
        with self.assertRaisesRegex(PolicyError, "provisioned"):
            targets.validate_config(dict(binding(), profile="fabric"), require)
        with self.assertRaisesRegex(PolicyError, "Production requires Fabric"):
            targets.validate_config(dict(binding("production"), profile="light"), require)

    def test_ci_evidence_is_branch_specific_even_for_identical_sha(self):
        sha = "a" * 40
        runs = [{"id": i, "head_sha": sha, "head_branch": "dev", "event": "push", "status": "completed", "conclusion": "success",
                 "path": ".github/workflows/" + name} for i, name in enumerate(("application-ci.yml", "blockchain-ci.yml", "dependency-audit.yml"))]
        ci_gate(runs, sha, sha, "dev")
        with self.assertRaises(PolicyError):
            ci_gate(runs, sha, sha, "main")

    def test_wrong_environment_archive_is_rejected_before_extraction(self):
        target = binding()
        files = {name: b"services: {}" for name in targets.APP_FILES}
        files.update({"blockchain/chaincode/src/index.ts": b"export {}", "blockchain/chaincode/dist/index.js": b"module.exports={}",
                      "apps/api/prisma/migrations/20260101_init/migration.sql": b"CREATE TABLE x (id INT);"})
        hashes = {k: sha256(v) for k, v in files.items()}
        manifest = {"format": 2, "sha": "a" * 40, "repository": target["repository"], "origin": target["origin"],
                    "files": hashes, "chaincode": fingerprint(hashes), "controller": {name: "0" * 64 for name in CONTROLLER_FILES},
                    "migrations": {"20260101_init": hashes["apps/api/prisma/migrations/20260101_init/migration.sql"]},
                    "api": "ghcr.io/kieutanphat/agri-trace-blockchain/api@sha256:" + "b" * 64,
                    "web": "ghcr.io/kieutanphat/agri-trace-blockchain/web@sha256:" + "c" * 64,
                    **{k: target[k] for k in ("environment", "branch", "project", "profile")}}
        for field, value in [(None, None), ("environment", "production"), ("branch", "main"), ("project", "agri-trace-uat"),
                             ("origin", "https://agritrace.dev"), ("format", 1), ("profile", "fabric")]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                changed = dict(manifest)
                if field:
                    changed[field] = value
                contents = dict(files, **{"cd-manifest.json": json.dumps(changed).encode()})
                archive = Path(temporary) / "release.tar.gz"
                with tarfile.open(archive, "w:gz") as tar:
                    for name, data in contents.items():
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        tar.addfile(member, io.BytesIO(data))
                destination = Path(temporary) / "validated"
                if field:
                    with self.assertRaises(PolicyError):
                        extract(archive, destination, manifest["sha"], target["repository"], target["origin"], target)
                    self.assertFalse(destination.exists())
                else:
                    extract(archive, destination, manifest["sha"], target["repository"], target["origin"], target)
                    self.assertTrue(destination.exists())


class LightweightController(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.config = binding()
        self.config.update(base=str(root), env=str(root / ".env"), accounts=str(root / "accounts.json"))
        (root / ".env").write_text("PUBLIC_ORIGIN=https://nongtrace.site\nCORS_ORIGINS=https://nongtrace.site,https://www.nongtrace.site\nPOSTGRES_USER=dev\nPOSTGRES_DB=dev\n")
        (root / "accounts.json").write_text("[]")
        (root / "backups").mkdir()
        # Filesystem fixtures are temporary; production validation is tested above.
        with patch.object(controller_policy.targets, "validate_config", return_value=self.config):
            self.controller = Controller(self.config)
        self.record = {"id": "dev-" + "a" * 40, "sha": "a" * 40, "directory": str(root / "release"),
                       "manifest": {"format": 2, "api": "api:test", "web": "web:test"}}

    def test_dev_commands_do_not_manage_proxy_or_worker(self):
        calls = []
        self.controller.run = lambda label, args, **kwargs: calls.append((label, args)) or b""
        self.controller.origin_for = lambda record: "http://127.0.0.1"
        self.controller.start(self.record)
        self.controller.stop(self.record)
        self.controller.resume_fabric()
        self.assertEqual([label for label, _ in calls], ["api-readiness", "web-proxy-readiness", "stop-writers"])
        self.assertFalse(any("worker" in args or "proxy" in args or "fabric_test" in args for _, args in calls))
        for _, args in calls:
            self.assertEqual(args[args.index("--project-name") + 1], "agritrace-dev")

    def test_light_backup_never_stops_or_reads_any_fabric_volume(self):
        calls = []
        def run(label, args, output=None, **kwargs):
            calls.append((label, args))
            if output:
                output.write(b"disposable dump")
            if "-czf" in args:
                Path(args[args.index("-czf") + 1]).write_bytes(b"private fixture")
            if "-cf" in args:
                Path(args[args.index("-cf") + 1]).write_bytes(b"archive fixture")
            if "-out" in args:
                Path(args[args.index("-out") + 1]).write_bytes(b"encrypted fixture")
            return b""
        self.controller.run = run
        with patch("controller.atomic_json", side_effect=lambda path, value: Path(path).parent.mkdir(parents=True, exist_ok=True) or Path(path).write_text(json.dumps(value))):
            result = self.controller.snapshot(self.record, "b" * 40, {})
        self.assertTrue((Path(result) / "snapshot.cms").exists())
        self.assertFalse(any("fabric" in label or args[:2] in (["docker", "stop"], ["docker", "start"], ["docker", "volume"])
                             for label, args in calls))
        self.assertFalse(any("agri-trace-uat" in str(args) for _, args in calls))

    def test_disabled_delivery_rejects_before_reading_transport(self):
        self.controller.state = lambda: {"current": self.record["id"]}
        stream = io.BytesIO(b"never read")
        with self.assertRaisesRegex(ControllerError, "disabled"):
            self.controller.execute(["deploy", "a" * 40, "b" * 64], stream)
        self.assertEqual(stream.tell(), 0)

    def test_initial_database_cannot_reuse_an_existing_unmanaged_volume(self):
        self.controller.state = lambda: {"current": None}
        self.controller.preflight = lambda record: None
        with patch("controller.subprocess.run") as command:
            command.return_value.returncode = 0
            command.return_value.stderr = b""
            with self.assertRaisesRegex(ControllerError, "already exists"):
                self.controller.initialize_development(self.record)
        self.assertFalse((self.controller.storage / "journal.json").exists())

    def test_initial_recovery_preserves_journal_and_stops_writers_on_foreign_schema(self):
        self.record["manifest"]["migrations"] = {}
        self.record["manifest"]["chaincode"] = "e" * 64
        self.controller.storage.mkdir()
        journal = self.controller.storage / "journal.json"
        journal.write_text(json.dumps({"previous": None, "candidate": self.record["id"]}))
        self.controller.state = lambda: {"current": None}
        self.controller.record = lambda release: self.record
        self.controller.preflight = lambda record: None
        self.controller.applied = lambda record: {"unrelated_migration": "d" * 64}
        calls = []
        def run(label, args, **kwargs):
            calls.append(label)
            if label == "initial-volume-ownership":
                return json.dumps([{"Labels": {"com.docker.compose.project": self.controller.project}}]).encode()
            return b"t" if label == "initial-migration-catalog" else b""
        self.controller.run = run
        with self.assertRaisesRegex(ControllerError, "Initial dev provisioning failed"):
            self.controller.recover()
        self.assertTrue(journal.exists())
        self.assertEqual(calls[-1], "stop-writers")
        self.assertFalse(any(label in calls for label in ("database-migration", "initial-dev-catalog", "api-readiness")))

    def test_initial_recovery_rejects_relabelled_data_volume(self):
        self.controller.run = lambda label, args, **kwargs: json.dumps([{"Labels": {"com.docker.compose.project": "agri-trace-uat"}}]).encode()
        stopped = []
        self.controller.stop = lambda record: stopped.append(record["id"])
        with self.assertRaisesRegex(ControllerError, "Initial dev provisioning failed"):
            self.controller.complete_initial_development(self.record)
        self.assertEqual(stopped, [self.record["id"]])


if __name__ == "__main__":
    unittest.main()
