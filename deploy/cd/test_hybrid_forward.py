"""First-floor forward recovery orchestration; all Docker/SQL/network I/O is stubbed.

The real controller, journal/state persistence, migration checksum policy and
independent metadata digest execute. This does not validate PostgreSQL SQL or
CMS decryption; snapshot_reference receives a bounded unit-test receipt.
"""
import copy
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest.mock import patch

from test_controller import Rehearsal, module

Controller = module.Controller
PolicyError = module.PolicyError
atomic_json = module.atomic_json
policy = module.policy


class ForwardRehearsal(Rehearsal):
    def __init__(self, config):
        super().__init__(config)
        self.catalog = {}
        self.unfinished = None
        self.migrated_names = []
        self.verify_canaries = []
        self.definition_value = {"sequence": 3, "version": "scope-before-cutover"}
        self.snapshot_value = None
        self.failure = None
        self.after_readiness = None
        self.gate_calls = 0
        self.writers_running = False

    def preflight(self, record):
        super().preflight(record)
        if self.failure == "preflight":
            raise PolicyError("simulated preflight rejection")

    def applied(self, record):
        return Controller.applied(self, record)

    def run(self, label, args, **kwargs):
        self.calls.append(label)
        self.phase = label
        if label == "migration-catalog":
            return "".join(f"{name}|{digest}|{'f' if name == self.unfinished else 't'}\n"
                           for name, digest in sorted(self.catalog.items())).encode()
        if label == "migration-deploy":
            if self.failure == "migration":
                raise PolicyError("simulated migration failure")
            target = self.migration_target["manifest"]["migrations"]
            self.migrated_names += sorted(set(target) - set(self.catalog))
            self.catalog = copy.deepcopy(target)
            return b""
        raise AssertionError("Unexpected external operation: " + label)

    def migrate(self, record):
        self.migration_target = record
        return Controller.migrate(self, record)

    def server_gate(self, record, auth):
        self.calls.append("server-gate")
        self.gate_calls += 1
        if self.failure == "server-gate" or (self.failure == "stale-second-gate" and self.gate_calls == 2):
            raise PolicyError("simulated exact-SHA CI rejection")

    def definition(self):
        self.calls.append("actual-definition")
        return copy.deepcopy(self.definition_value)

    def snapshot_reference(self, directory, source_sha):
        self.calls.append("snapshot-reference")
        if self.failure == "snapshot":
            raise PolicyError("Completed cutover snapshot index is missing")
        if self.failure == "snapshot-drift":
            return dict(self.snapshot_value, encryptedSha256="f" * 64)
        assert directory == self.snapshot_value["directory"]
        assert source_sha == self.snapshot_value["sourceSha"]
        return copy.deepcopy(self.snapshot_value)

    def hybrid_readiness(self, record):
        self.calls.append("hybrid-readiness")
        if self.failure == "readiness":
            raise PolicyError("simulated active-route/history readiness rejection")
        if self.after_readiness:
            self.after_readiness()

    def start(self, record):
        super().start(record)
        if self.failure == "start":
            raise PolicyError("simulated partially started application")

    def verify(self, record, canary=None):
        self.verify_canaries.append(canary)
        if self.failure == "verification":
            self.calls.append("verify-" + record["id"])
            raise PolicyError("simulated verification failure")
        return super().verify(record, canary)

    def stop(self, record):
        if self.failure == "stop":
            self.calls.append("stop-failed")
            raise PolicyError("simulated stop failure")
        return super().stop(record)


@unittest.skipIf(os.name == "nt", "Controller durability requires Linux directory fsync")
class HybridForward(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        (self.base / "cd").mkdir()
        self.env_file = self.base / "private.env"
        self.env_file.write_text("PUBLIC_ORIGIN=http://127.0.0.1:18080\n"
                                 "POSTGRES_USER=scope_test\nPOSTGRES_DB=scope_test\n", encoding="utf8")
        self.controller = ForwardRehearsal({"base": str(self.base), "env": str(self.env_file)})
        historical = {f"202601010000{index:02d}_history": policy.sha256(f"old-{index}".encode())
                      for index in range(1, 16)}
        self.scope_name = "20261013010000_hybrid_business_scope"
        self.route_name = "20261013011000_immutable_ledger_routes"
        self.catalog = dict(historical)
        for name, field in ((self.scope_name, "scope_fixture"), (self.route_name, "route_fixture")):
            script = f'ALTER TABLE "lot" ADD COLUMN "{field}" TEXT;\n'.encode()
            self.catalog[name] = policy.sha256(script)
            for release in ("original", "fix"):
                filename = self.base / release / "apps/api/prisma/migrations" / name / "migration.sql"
                filename.parent.mkdir(parents=True)
                filename.write_bytes(script)
        self.chaincode = {"fingerprint": "e" * 64, "sequence": 3, "version": "scope-before-cutover",
                          "packages": {"1": "original-package", "2": "original-package"}}
        self.old = {"id": "uat-" + "a" * 40, "sha": "a" * 40, "directory": str(self.base / "old"),
                    "verified": True, "legacyQrLotIds": ["retained-legacy-lot"],
                    "manifest": {"chaincode": self.chaincode["fingerprint"], "api": "api:old", "web": "web:old",
                                 "migrations": historical}}
        self.original = dict(copy.deepcopy(self.old), id="uat-" + "b" * 40, sha="b" * 40,
                             directory=str(self.base / "original"), verified=False)
        self.original["manifest"]["migrations"] = copy.deepcopy(self.catalog)
        self.fix = dict(copy.deepcopy(self.original), id="uat-" + "c" * 40, sha="c" * 40,
                        directory=str(self.base / "fix"), legacyQrLotIds=["unreviewed-exception"])
        for record in (self.old, self.original, self.fix):
            self.controller.save_record(record)
        self.state = {"current": self.old["id"], "chaincode": copy.deepcopy(self.chaincode),
                      "compatible_migrations": []}
        atomic_json(self.base / "cd/state.json", self.state)
        (self.base / "current").symlink_to(self.old["directory"])
        self.pins = self.base / "shared/hybrid/legacy-scope-pins.json"
        self.pins.parent.mkdir(parents=True)
        self.pins.write_text('{"schema":"agritrace-legacy-scope-pins-1","pins":[]}\n', encoding="utf8")
        self.pins.chmod(0o644)
        self.controller.environment.update({
            "HYBRID_LEGACY_MANIFEST_PINS_HOST": str(self.pins),
            "HYBRID_SCOPE_CUTOVER_SHA": self.original["sha"],
            "LEDGER_ROUTE_PINS": json.dumps(["d" * 64]), "LEDGER_ACTIVE_ROUTE_DIGEST": "d" * 64,
            "LEDGER_ROUTE_IMPORT_PINS": "[]", "LEDGER_PAUSED_WRITER_PINS": "[]",
            "LEDGER_WRITER_AUTHORITY": "production:technical-relayer",
        })
        self.env_file.write_text("".join(f"{key}={value}\n" for key, value in self.controller.environment.items()), encoding="utf8")
        self.snapshot = {"sourceSha": self.original["sha"], "directory": str(self.base / "backups/original"),
                         "encryptedSha256": "7" * 64, "checksumsSha256": "8" * 64}
        self.controller.snapshot_value = copy.deepcopy(self.snapshot)
        atomic_json(self.base / "cd/backups.json", {self.original["sha"]: self.snapshot["directory"]})
        self.journal = {"previous": self.old["id"], "candidate": self.original["id"], "stage": "application",
                        "baseline": copy.deepcopy(self.controller.data), "scopeCutover": {
                            "sourceSha": self.original["sha"], "originalCandidate": self.original["id"],
                            "migrations": copy.deepcopy(self.catalog), "metadataDigest": policy.hybrid_metadata_digest(self.controller.environment, self.base),
                            "chaincode": copy.deepcopy(self.chaincode), "snapshot": copy.deepcopy(self.snapshot)}}
        self.write_journal()
        self.controller.catalog = copy.deepcopy(self.catalog)
        self.auth = {"username": "fixture-user", "token": "not-a-real-credential-for-unit-test"}

    def write_journal(self):
        atomic_json(self.base / "cd/journal.json", self.journal)

    def forward(self):
        return self.controller.forward(self.fix, self.controller.state(), self.auth)

    def held(self, regex=None):
        exception = self.assertRaisesRegex(PolicyError, regex) if regex else self.assertRaises(PolicyError)
        with exception:
            self.forward()
        self.assertTrue((self.base / "cd/journal.json").is_file())
        self.assertFalse(self.controller.writers_running)
        self.assertNotIn("start-" + self.old["id"], self.controller.calls)
        self.assertFalse(any(label in self.controller.calls for label in ("reconcile-definition", "restore", "snapshot", "chaincode-upgrade")))
        return exception.exception

    def test_full_floor_forward_promotes_only_after_readiness_verification_and_preservation(self):
        result = self.forward()
        self.assertEqual(result["result"], "forward-recovered")
        self.assertEqual(result["snapshotSourceSha"], self.original["sha"])
        self.assertEqual(self.controller.state()["current"], self.fix["id"])
        self.assertEqual(self.controller.state()["previous"], self.old["id"])
        self.assertFalse((self.base / "cd/journal.json").exists())
        self.assertEqual(self.controller.migrated_names, [])
        self.assertEqual(self.controller.verify_canaries, [self.fix["sha"]])
        saved = self.controller.record(self.fix["id"])
        self.assertTrue(saved["verified"])
        self.assertEqual(saved["legacyQrLotIds"], self.old["legacyQrLotIds"])
        self.assertEqual(saved["chaincode"], self.chaincode)
        self.assertEqual(json.loads((self.base / "cd/backups.json").read_text())[self.fix["sha"]], self.snapshot["directory"])
        self.assertLess(self.controller.calls.index("hybrid-readiness"), self.controller.calls.index("start-" + self.fix["id"]))
        self.assertEqual(self.controller.gate_calls, 2)

    def test_completed_scope_without_route_finishes_only_the_missing_route_migration(self):
        del self.controller.catalog[self.route_name]
        self.assertEqual(len(self.controller.catalog), 16)
        self.forward()
        self.assertEqual(self.controller.migrated_names, [self.route_name])
        self.assertEqual(self.controller.catalog, self.catalog)

    def test_an_unfinished_prisma_row_is_never_resolved_or_reexecuted(self):
        self.controller.unfinished = self.scope_name
        self.held("unfinished database migration")
        self.assertNotIn("migration-deploy", self.controller.calls)

    def test_unknown_completed_migration_is_held_before_migration_or_start(self):
        self.controller.catalog["20261013012000_unknown"] = "9" * 64
        self.held("absent from release")
        self.assertNotIn("migration-deploy", self.controller.calls)

    def test_a_different_or_partial_candidate_catalog_is_rejected(self):
        for change in ("checksum", "missing-floor", "additional"):
            with self.subTest(change=change):
                original = copy.deepcopy(self.fix["manifest"]["migrations"])
                if change == "checksum":
                    self.fix["manifest"]["migrations"][self.route_name] = "9" * 64
                elif change == "missing-floor":
                    del self.fix["manifest"]["migrations"][self.route_name]
                else:
                    self.fix["manifest"]["migrations"]["20261014010000_extra"] = "9" * 64
                self.held("exact reviewed migration catalog")
                self.fix["manifest"]["migrations"] = original

    def test_original_cutover_acknowledgement_cannot_be_replaced_by_the_forward_sha(self):
        self.controller.environment["HYBRID_SCOPE_CUTOVER_SHA"] = self.fix["sha"]
        self.held("original independent cutover acknowledgement")

    def test_independent_pin_file_or_environment_drift_is_held(self):
        for change in ("file", "environment"):
            with self.subTest(change=change):
                if change == "file":
                    self.pins.write_text('{"schema":"agritrace-legacy-scope-pins-1","pins":[]} ', encoding="utf8")
                else:
                    self.controller.environment["LEDGER_WRITER_AUTHORITY"] = "another:authority"
                    self.env_file.write_text("".join(f"{key}={value}\n" for key, value in self.controller.environment.items()), encoding="utf8")
                self.held("metadata changed since cutover")
                self.pins.write_text('{"schema":"agritrace-legacy-scope-pins-1","pins":[]}\n', encoding="utf8")

    def test_missing_or_changed_completed_backup_is_held(self):
        for failure in ("snapshot", "snapshot-drift"):
            with self.subTest(failure=failure):
                self.controller.failure = failure
                self.held()
                self.assertNotIn("migration-deploy", self.controller.calls)

    def test_manifest_and_saved_chaincode_changes_cannot_cross_forward_recovery(self):
        self.fix["manifest"]["chaincode"] = "f" * 64
        self.held("chaincode package")
        self.fix["manifest"]["chaincode"] = self.chaincode["fingerprint"]
        changed = dict(self.state, chaincode=dict(self.chaincode, packages={"1": "changed", "2": "changed"}))
        atomic_json(self.base / "cd/state.json", changed)
        self.held("chaincode state changed")

    def test_actual_chaincode_sequence_or_version_drift_never_starts_an_application(self):
        for changed in ({"sequence": 4, "version": self.chaincode["version"]},
                        {"sequence": 3, "version": "unreviewed-version"}):
            with self.subTest(actual=changed):
                self.controller.definition_value = changed
                error = self.held("Forward recovery failed")
                self.assertIn("Actual Fabric definition changed", str(error.__cause__))
                self.assertNotIn("migration-deploy", self.controller.calls)

    def test_forward_rejects_missing_admission_baseline_or_an_unrelated_state(self):
        for key in ("scopeCutover", "baseline", "previous"):
            with self.subTest(missing=key):
                saved = self.journal.pop(key)
                self.write_journal()
                self.held("cutover admission")
                self.journal[key] = saved
        self.write_journal()
        atomic_json(self.base / "cd/state.json", dict(self.state, current="uat-" + "f" * 40))
        self.held("outside the pinned cutover")

    def test_forward_is_not_allowed_after_a_routine_already_scope_aware_release(self):
        self.old["manifest"]["migrations"] = copy.deepcopy(self.catalog)
        self.controller.save_record(self.old)
        self.held("reserved for the first")

    def test_no_journal_means_no_forward_operation_or_service_change(self):
        (self.base / "cd/journal.json").unlink()
        with self.assertRaisesRegex(PolicyError, "interrupted first-floor cutover"):
            self.forward()
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(self.controller.state(), self.state)

    def test_actual_readiness_contract_requires_same_sha_readonly_and_no_signer(self):
        accepted = {"result": "passed", "sourceSha": self.fix["sha"], "readOnly": True, "signingMaterialRead": False}
        with patch.object(self.controller, "run", return_value=json.dumps(accepted).encode()):
            Controller.hybrid_readiness(self.controller, self.fix)
        for changed in ({"result": "failed"}, {"sourceSha": self.old["sha"]},
                        {"readOnly": False}, {"signingMaterialRead": True}):
            with self.subTest(changed=changed), \
                    patch.object(self.controller, "run", return_value=json.dumps(dict(accepted, **changed)).encode()), \
                    self.assertRaisesRegex(PolicyError, "writers remain stopped"):
                Controller.hybrid_readiness(self.controller, self.fix)
        self.assertFalse(self.controller.writers_running)

    def test_preflight_gate_readiness_and_verification_failures_keep_writers_stopped(self):
        for failure in ("preflight", "server-gate", "migration", "readiness", "verification", "start", "stale-second-gate"):
            with self.subTest(failure=failure):
                self.write_journal()
                self.controller.failure = failure
                self.controller.gate_calls = 0
                self.controller.calls = []
                self.held()

    def test_metadata_mutation_after_readiness_is_detected_before_start(self):
        self.controller.after_readiness = lambda: self.controller.environment.update(LEDGER_ROUTE_PINS='["' + "f" * 64 + '"]')
        self.held("Forward recovery failed")
        self.assertNotIn("start-" + self.fix["id"], self.controller.calls)

    def test_live_shared_environment_change_cannot_hide_behind_cached_metadata(self):
        def change():
            live = dict(self.controller.environment, LEDGER_ACTIVE_ROUTE_DIGEST="f" * 64)
            self.env_file.write_text("".join(f"{key}={value}\n" for key, value in live.items()), encoding="utf8")
        self.controller.after_readiness = change
        error = self.held("Forward recovery failed")
        self.assertIn("Shared deployment environment changed", str(error.__cause__))
        self.assertNotIn("start-" + self.fix["id"], self.controller.calls)

    def test_actual_binding_drift_after_migration_and_readiness_is_rechecked_before_start(self):
        original = self.controller.definition
        count = 0
        def definition():
            nonlocal count
            count += 1
            return original() if count == 1 else {"sequence": 4, "version": "changed-late"}
        with patch.object(self.controller, "definition", side_effect=definition):
            error = self.held("Forward recovery failed")
        self.assertIn("before writer startup", str(error.__cause__))
        self.assertEqual(count, 2)
        self.assertNotIn("start-" + self.fix["id"], self.controller.calls)

    def test_unrelated_current_symlink_is_not_a_valid_interrupted_forward_attempt(self):
        (self.base / "current").unlink()
        (self.base / "current").symlink_to(self.base / "unrelated")
        self.held("Current release link is outside")
        self.assertNotIn("migration-deploy", self.controller.calls)

    def test_lost_history_or_reduced_counts_after_start_prevent_promotion(self):
        for field in ("fingerprints", "counts"):
            with self.subTest(field=field):
                self.write_journal()
                self.controller.calls = []
                saved = copy.deepcopy(self.controller.data)
                if field == "fingerprints":
                    self.controller.data["fingerprints"] = {"event": "changed"}
                else:
                    self.controller.data["counts"] = {"trace_event": 39}
                self.held("Forward recovery failed")
                self.assertEqual(self.controller.state()["current"], self.old["id"])
                self.controller.data = saved

    def test_state_or_result_write_failure_retains_journal_and_allows_same_canary_retry(self):
        for filename in ("state.json", "last-result.json"):
            with self.subTest(filename=filename):
                atomic_json(self.base / "cd/state.json", self.state)
                (self.base / "current").unlink()
                (self.base / "current").symlink_to(self.old["directory"])
                self.write_journal()
                self.controller.calls = []
                self.controller.verify_canaries = []
                triggered = False

                def fail_once(path, data):
                    nonlocal triggered
                    if Path(path).name == filename and not triggered:
                        triggered = True
                        raise OSError("simulated durable write failure")
                    return atomic_json(path, data)

                with patch.object(module, "atomic_json", side_effect=fail_once):
                    self.held("Forward recovery failed")
                interrupted = json.loads((self.base / "cd/journal.json").read_text())
                self.assertEqual(interrupted["previous"], self.old["id"])
                self.assertEqual(interrupted["scopeCutover"], self.journal["scopeCutover"])
                self.assertEqual(interrupted["forwardAttempts"], [self.fix["id"]])
                self.assertEqual(self.forward()["result"], "forward-recovered")
                self.assertEqual(self.controller.verify_canaries, [self.fix["sha"], self.fix["sha"]])

    def test_record_save_failure_stops_started_writers_without_erasing_original_cutover(self):
        original_save = self.controller.save_record

        def fail(record):
            if record["id"] == self.fix["id"]:
                raise OSError("simulated record persistence failure")
            return original_save(record)

        with patch.object(self.controller, "save_record", side_effect=fail):
            self.held("Forward recovery failed")
        journal = json.loads((self.base / "cd/journal.json").read_text())
        self.assertEqual(journal["baseline"], self.journal["baseline"])
        self.assertEqual(journal["scopeCutover"], self.journal["scopeCutover"])
        self.assertEqual(self.forward()["result"], "forward-recovered")

    def test_a_previous_snapshot_for_the_forward_sha_is_never_overwritten(self):
        existing = dict({self.original["sha"]: self.snapshot["directory"]}, **{self.fix["sha"]: "different-saved-snapshot"})
        atomic_json(self.base / "cd/backups.json", existing)
        self.held("Forward recovery failed")
        self.assertEqual(json.loads((self.base / "cd/backups.json").read_text()), existing)

    def test_scope_floor_admission_is_independent_and_applies_to_partial_floor(self):
        for applied in (self.old["manifest"]["migrations"], dict(self.old["manifest"]["migrations"], **{self.scope_name: self.catalog[self.scope_name]})):
            with self.subTest(applied=len(applied)):
                self.assertTrue(policy.scope_floor_admission(self.original["manifest"], self.original["sha"], applied, self.controller.environment))
                with self.assertRaisesRegex(PolicyError, "independent SHA acknowledgement"):
                    policy.scope_floor_admission(self.original["manifest"], self.fix["sha"], applied, self.controller.environment)
        self.assertFalse(policy.scope_floor_admission(self.fix["manifest"], self.fix["sha"], self.catalog, {}))
        partial = copy.deepcopy(self.original["manifest"])
        del partial["migrations"][self.route_name]
        with self.assertRaisesRegex(PolicyError, "full scope/ledger"):
            policy.scope_floor_admission(partial, self.original["sha"], {}, self.controller.environment)

    def test_unknown_forward_command_and_validation_errors_do_not_print_credentials(self):
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            for command in ("forward", "forward private-fixture-placeholder " + "d" * 64,
                            "forward " + "a" * 40 + " private-fixture-placeholder"):
                with self.assertRaises(PolicyError) as captured:
                    policy.command(command)
                self.assertNotIn("private-fixture-placeholder", str(captured.exception))
        self.assertEqual(output.getvalue(), "")
        self.assertEqual(policy.command("forward " + "a" * 40 + " " + "d" * 64), ["forward", "a" * 40, "d" * 64])


@unittest.skipIf(os.name == "nt", "Controller durability requires Linux directory fsync")
class HybridQuiescentEvidence(unittest.TestCase):
    def test_actual_quiescent_method_keeps_events_committed_after_the_earlier_verify(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            env = base / "private.env"
            env.write_text("PUBLIC_ORIGIN=http://127.0.0.1:18080\nPOSTGRES_USER=test\nPOSTGRES_DB=test\n", encoding="utf8")
            controller = Controller({"base": str(base), "env": str(env)})
            rows = [{"event_id": "early-event", "event_row": "earlier immutable bytes", "proof": ["tx", "hash", "agritrace"]},
                    {"event_id": "last-committed-event", "event_row": "committed while stop drained", "proof": None}]
            original = {"result": "passed", "counts": {"trace_event": 1}, "fingerprints": {
                "event:early-event": policy.sha256(rows[0]["event_row"].encode()),
                "proof:early-event": policy.sha256(json.dumps(rows[0]["proof"], separators=(",", ":")).encode())}}
            raw = {"counts": {"trace_event": 2}, "events": rows}
            with patch.object(controller, "dc", return_value=["disposable-sql"]) as dc, \
                    patch.object(controller, "run", return_value=json.dumps(raw).encode()) as run:
                frozen = controller.quiescent_baseline({}, original)
            self.assertEqual(frozen["counts"]["trace_event"], 2)
            self.assertIn("event:last-committed-event", frozen["fingerprints"])
            self.assertEqual(frozen["fingerprints"]["proof:early-event"], original["fingerprints"]["proof:early-event"])
            self.assertIn("REPEATABLE READ READ ONLY", dc.call_args.args[-1])
            with self.assertRaisesRegex(PolicyError, "history changed"):
                controller.preserve(frozen, original)
