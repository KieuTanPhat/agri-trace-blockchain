import copy
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("cd_aliases", Path(__file__).with_name("aliases.py"))
aliases = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aliases)


class HttpsAliases(unittest.TestCase):
    def setUp(self):
        self.environment = {"PUBLIC_ORIGIN": "https://nongtrace.site",
                            "CADDY_SITE_ADDRESS": "nongtrace.site, www.nongtrace.site, http://13.140.170.166",
                            "CORS_ORIGINS": "http://13.140.170.166,https://nongtrace.site,https://www.nongtrace.site",
                            "JWT_SECRET": "untouched-test-value"}

    def test_aliases_preserve_primary_origin_existing_hosts_and_unrelated_settings(self):
        additions = ["https://agritrace.dev", "https://www.agritrace.dev"]
        result = aliases.alias_environment(self.environment, additions)
        self.assertEqual(result["PUBLIC_ORIGIN"], self.environment["PUBLIC_ORIGIN"])
        self.assertEqual(result["JWT_SECRET"], self.environment["JWT_SECRET"])
        self.assertEqual(result["CADDY_SITE_ADDRESS"], self.environment["CADDY_SITE_ADDRESS"] + ", agritrace.dev, www.agritrace.dev")
        self.assertEqual(result["CORS_ORIGINS"], self.environment["CORS_ORIGINS"] + "," + ",".join(additions))
        self.assertEqual(aliases.alias_environment(result, additions), result)
        self.assertNotIn("PUBLIC_ALIAS_ORIGINS", self.environment)

    def test_malformed_aliases_cannot_inject_hosts_cors_or_environment_lines(self):
        for value in ("http://agritrace.dev", "https://127.0.0.1", "https://agritrace.dev/", "https://agritrace.dev:443",
                      "https://user@agritrace.dev", "https://agritrace.dev?query=1", "https://*.agritrace.dev",
                      "https://agritrace.dev\nJWT_SECRET=changed", "https://agritrace.dev,evil.example"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                aliases.alias_environment(self.environment, [value])

    def test_environment_edit_preserves_unrelated_secret_bytes_and_rejects_duplicate_public_keys(self):
        raw = b"# private\r\nJWT_SECRET=a=b=c\r\nCORS_ORIGINS=old\r\nFINAL=unchanged\r\n"
        result = aliases.replace_environment(raw, {"CORS_ORIGINS": "new", "PUBLIC_ALIAS_ORIGINS": "https://agritrace.dev"})
        self.assertIn(b"JWT_SECRET=a=b=c\r\n", result)
        self.assertIn(b"FINAL=unchanged\r\n", result)
        self.assertIn(b"CORS_ORIGINS=new\r\n", result)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            aliases.replace_environment(b"CORS_ORIGINS=a\nCORS_ORIGINS=b\n", {"CORS_ORIGINS": "c"})

    def test_compose_guard_rejects_changes_to_images_secrets_ports_and_worker(self):
        before = {"services": {"api": {"environment": {"CORS_ORIGIN": "old", "JWT_SECRET": "same"}, "image": "pinned-api"},
                               "proxy": {"environment": {"CADDY_SITE_ADDRESS": "old"}, "ports": [80, 443]},
                               "worker": {"image": "pinned-worker"}}}
        after = copy.deepcopy(before)
        after["services"]["api"]["environment"]["CORS_ORIGIN"] = "new"
        after["services"]["proxy"]["environment"]["CADDY_SITE_ADDRESS"] = "new"
        aliases.unchanged_model(before, after)
        for service, field, value in (("api", "image", "different"), ("worker", "image", "different"),
                                      ("proxy", "ports", [80, 443, 5432])):
            changed = copy.deepcopy(after)
            changed["services"][service][field] = value
            with self.assertRaisesRegex(ValueError, "outside"):
                aliases.unchanged_model(before, changed)
        after["services"]["api"]["environment"]["JWT_SECRET"] = "different"
        with self.assertRaises(ValueError):
            aliases.unchanged_model(before, after)

    def test_history_guard_allows_new_events_but_rejects_modification_or_deletion(self):
        before = {"trace_event": {"id": "hash"}}
        aliases.preserve_data(before, {"trace_event": {"id": "hash", "new": "new-hash"}})
        for after in ({"trace_event": {}}, {"trace_event": {"id": "changed"}}):
            with self.assertRaises(ValueError):
                aliases.preserve_data(before, after)

    def test_failed_rollout_restores_both_files_and_restarts_only_targets(self):
        controller = MagicMock()
        writes = []
        original = b"PUBLIC_ORIGIN=https://nongtrace.site\nCORS_ORIGINS=old\n"
        target = b"PUBLIC_ORIGIN=https://nongtrace.site\nCORS_ORIGINS=new\n"
        with patch.object(aliases, "atomic_write", side_effect=lambda path, data: writes.append((path, data))), \
                patch.object(aliases, "start_targets") as start, patch.object(aliases, "verify_public") as public:
            with self.assertRaisesRegex(RuntimeError, "simulated"):
                aliases.transition(controller, {}, "shared", "release", target, original, b"old-release",
                                   lambda: (_ for _ in ()).throw(RuntimeError("simulated verification failure")))
        self.assertEqual(writes, [("shared", target), ("shared", original), ("release", b"old-release")])
        self.assertEqual(start.call_count, 2)
        self.assertEqual(controller.environment["CORS_ORIGINS"], "old")
        public.assert_called_once()

    def test_runtime_guard_rejects_other_service_restarts_or_changed_images(self):
        before = {"agri-trace-uat-web-1": {"id": "same", "image": "pinned", "status": "running", "health": "healthy"}}
        aliases.preserve_runtime(before, copy.deepcopy(before))
        for key in ("id", "image", "health"):
            after = copy.deepcopy(before)
            after["agri-trace-uat-web-1"][key] = "changed"
            with self.assertRaises(ValueError):
                aliases.preserve_runtime(before, after)


@unittest.skipIf(os.name == "nt", "Deployment locking uses Linux flock")
class AliasDeliveryLock(unittest.TestCase):
    def test_running_delivery_and_recovery_journal_block_alias_changes(self):
        import fcntl
        with tempfile.TemporaryDirectory() as directory, patch.object(aliases.os, "getuid", return_value=0):
            base = Path(directory)
            (base / "cd").mkdir()
            with (base / "cd/delivery.lock").open("a") as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(ValueError, "Another delivery"):
                    with aliases.delivery_lock(base):
                        self.fail("Entered while delivery was running")
            (base / "cd/journal.json").write_text("{}")
            with self.assertRaisesRegex(ValueError, "Recover"):
                with aliases.delivery_lock(base):
                    self.fail("Entered with a recovery journal")


if __name__ == "__main__":
    unittest.main()
