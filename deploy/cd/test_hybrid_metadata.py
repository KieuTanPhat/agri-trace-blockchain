import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

from policy import LEGACY_PINS_TARGET, PolicyError, REQUIRED_RELEASE_MIGRATIONS, hybrid_environment, sha256


@unittest.skipIf(os.name == "nt", "Production metadata ownership uses Linux paths and permissions")
class HybridMetadata(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        self.file = self.base / "shared/hybrid/legacy-scope-pins.json"
        self.file.parent.mkdir(parents=True)
        self.file.write_text(json.dumps({"schema": "agritrace-legacy-scope-pins-1", "pins": []}), encoding="utf-8")
        self.file.chmod(0o644)
        self.sha = "a" * 40
        self.manifest = {"format": 2, "migrations": {name: "b" * 64 for name in REQUIRED_RELEASE_MIGRATIONS}}
        self.env = {
            "LEDGER_ROUTE_PINS": json.dumps(["c" * 64]),
            "LEDGER_ACTIVE_ROUTE_DIGEST": "c" * 64,
            "LEDGER_ROUTE_IMPORT_PINS": json.dumps([{"digest": "d" * 64, "environment": "production", "sourceSha": "e" * 40}]),
            "LEDGER_PAUSED_WRITER_PINS": json.dumps(["f" * 64]),
            "LEDGER_WRITER_AUTHORITY": "production:technical-relayer",
            "HYBRID_LEGACY_MANIFEST_PINS_HOST": str(self.file),
        }
        values = {key: value for key, value in self.env.items() if key.startswith("LEDGER_")}
        values.update(NODE_ENV="production", APP_RELEASE_SHA=self.sha, HYBRID_LEGACY_MANIFEST_PINS_FILE=LEGACY_PINS_TARGET, FABRIC_ENABLED="false")
        mount = {"type": "bind", "source": str(self.file), "target": LEGACY_PINS_TARGET,
                 "read_only": True, "bind": {"create_host_path": False}}
        self.services = {name: {"environment": dict(values), "volumes": [copy.deepcopy(mount)]} for name in ("api", "worker")}
        self.services["api"]["environment"].pop("LEDGER_WRITER_AUTHORITY")
        self.services["worker"]["environment"]["FABRIC_ENABLED"] = "true"
        writer = self.services["worker"]["environment"]
        writer.update(FABRIC_NETWORK_NAME="hyperledger-fabric", FABRIC_CHANNEL_NAME="agritrace",
                      FABRIC_CHAINCODE_NAME="agritrace", FABRIC_CONTRACT_NAME="AgriTraceContract", FABRIC_MSP_ID="Org1MSP")
        route = {"protocol": "agritrace-ledger-route/1", "mode": "WRITE", "network": "hyperledger-fabric",
                 "channelId": "agritrace", "chaincodeName": "agritrace", "contractName": "AgriTraceContract",
                 "envelopeVersion": "3.0.0", "writerAuthority": self.env["LEDGER_WRITER_AUTHORITY"],
                 "writerMspId": "Org1MSP", "writerRole": "relayer"}
        self.active = sha256(json.dumps(route, sort_keys=True, separators=(",", ":")).encode())
        self.env.update(LEDGER_ROUTE_PINS=json.dumps([self.active]), LEDGER_ACTIVE_ROUTE_DIGEST=self.active)
        for service in self.services.values():
            service["environment"].update(LEDGER_ROUTE_PINS=self.env["LEDGER_ROUTE_PINS"], LEDGER_ACTIVE_ROUTE_DIGEST=self.active)

    def check(self):
        return hybrid_environment(self.manifest, self.sha, self.services, self.env, self.base)

    def test_scope_aware_services_receive_only_independent_readonly_metadata(self):
        self.assertTrue(self.check())
        self.assertFalse(hybrid_environment({"migrations": {}}, self.sha, {}, {}, self.base))

    def test_partial_schema_floor_is_not_a_deployable_release(self):
        self.manifest["migrations"].pop(next(iter(REQUIRED_RELEASE_MIGRATIONS)))
        with self.assertRaisesRegex(PolicyError, "complete scope/ledger"):
            self.check()

    def test_missing_duplicate_or_unpinned_active_routes_are_rejected(self):
        for routes, active in [("[]", "c" * 64), (json.dumps(["c" * 64] * 2), "c" * 64),
                               ("not-json", "c" * 64), (json.dumps(["c" * 64]), "d" * 64)]:
            with self.subTest(routes=routes), self.assertRaises(PolicyError):
                self.env.update(LEDGER_ROUTE_PINS=routes, LEDGER_ACTIVE_ROUTE_DIGEST=active)
                self.check()

    def test_isolated_import_authority_cannot_enter_production(self):
        self.env["LEDGER_ROUTE_IMPORT_PINS"] = json.dumps([{"digest": "d" * 64, "environment": "isolated", "sourceSha": self.sha}])
        with self.assertRaisesRegex(PolicyError, "production route import"):
            self.check()

    def test_release_overlays_cannot_replace_the_operator_pins(self):
        for name in ("api", "worker"):
            with self.subTest(service=name):
                self.services[name]["environment"]["LEDGER_ROUTE_PINS"] = json.dumps(["0" * 64])
                with self.assertRaisesRegex(PolicyError, "deployment-owned"):
                    self.check()
                self.services[name]["environment"]["LEDGER_ROUTE_PINS"] = self.env["LEDGER_ROUTE_PINS"]

    def test_runtime_sha_and_worker_authority_must_match_the_delivery(self):
        for name, key, value in [("api", "APP_RELEASE_SHA", "0" * 40),
                                 ("worker", "LEDGER_WRITER_AUTHORITY", "another-relayer")]:
            with self.subTest(key=key):
                original = self.services[name]["environment"][key]
                self.services[name]["environment"][key] = value
                with self.assertRaises(PolicyError):
                    self.check()
                self.services[name]["environment"][key] = original

    def test_import_operator_gate_cannot_be_left_open_in_runtime(self):
        self.services["api"]["environment"]["LEDGER_ROUTE_IMPORT_ENABLED"] = "true"
        with self.assertRaisesRegex(PolicyError, "Operator import"):
            self.check()

    def test_active_digest_cannot_label_another_channel_or_writer_msp(self):
        for key in ("FABRIC_CHANNEL_NAME", "FABRIC_MSP_ID"):
            with self.subTest(key=key):
                values = self.services["worker"]["environment"]
                original = values[key]
                values[key] = "another-binding"
                with self.assertRaisesRegex(PolicyError, "digest differs"):
                    self.check()
                values[key] = original

    def test_runtime_pin_length_limits_cannot_be_waived_by_whitespace(self):
        for key, limit, sample in [("LEDGER_ROUTE_PINS", 20000, self.env["LEDGER_ROUTE_PINS"]),
                                   ("LEDGER_PAUSED_WRITER_PINS", 20000, "[]"),
                                   ("LEDGER_ROUTE_IMPORT_PINS", 65536, "[]")]:
            with self.subTest(key=key):
                original = self.env[key]
                self.env[key] = " " * limit + sample
                for service in self.services.values():
                    service["environment"][key] = self.env[key]
                with self.assertRaisesRegex(PolicyError, "Invalid Hybrid pin"):
                    self.check()
                self.env[key] = original
                for service in self.services.values():
                    service["environment"][key] = original

    def test_nonroot_services_require_readable_production_metadata(self):
        self.file.chmod(0o600)
        with self.assertRaisesRegex(PolicyError, "readable"):
            self.check()
        self.file.chmod(0o644)
        for name in ("api", "worker"):
            with self.subTest(service=name):
                self.services[name]["environment"]["NODE_ENV"] = "test"
                with self.assertRaisesRegex(PolicyError, "production metadata"):
                    self.check()
                self.services[name]["environment"]["NODE_ENV"] = "production"

    def test_api_cannot_receive_a_signing_key_mount_or_identity_environment(self):
        self.services["api"]["volumes"].append({"type": "bind", "source": "/private/key", "target": "/fabric-identity"})
        with self.assertRaisesRegex(PolicyError, "signing material"):
            self.check()
        self.services["api"]["volumes"].pop()
        self.services["api"]["environment"]["FABRIC_IDENTITY_KEY_DIR"] = "/private/key"
        with self.assertRaisesRegex(PolicyError, "signing material"):
            self.check()

    def test_writable_missing_or_automatically_created_metadata_mounts_are_rejected(self):
        mount = self.services["api"]["volumes"][0]
        for mutation in [dict(read_only=False), dict(bind={"create_host_path": True}), dict(source="/outside/pins.json")]:
            original = copy.deepcopy(mount)
            mount.update(mutation)
            with self.subTest(mutation=mutation), self.assertRaises(PolicyError):
                self.check()
            mount.clear()
            mount.update(original)
        self.file.chmod(0o666)
        with self.assertRaisesRegex(PolicyError, "writable"):
            self.check()
        self.file.chmod(0o644)
        self.file.unlink()
        with self.assertRaisesRegex(PolicyError, "regular"):
            self.check()

    def test_symlink_or_isolated_legacy_metadata_is_rejected(self):
        self.file.write_text(json.dumps({"schema": "agritrace-legacy-scope-pins-1", "pins": [{"manifest": {"environment": "isolated"}}]}), encoding="utf-8")
        with self.assertRaisesRegex(PolicyError, "production legacy"):
            self.check()
        target = self.file.with_name("other.json")
        self.file.rename(target)
        self.file.symlink_to(target)
        with self.assertRaisesRegex(PolicyError, "regular"):
            self.check()


if __name__ == "__main__":
    unittest.main()
