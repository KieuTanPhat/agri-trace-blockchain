import copy
import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
spec = importlib.util.spec_from_file_location("cutover", Path(__file__).with_name("cutover.py"))
cutover = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cutover)


class CutoverBoundaries(unittest.TestCase):
    def test_origin_replaces_allowlists_and_preserves_private_settings(self):
        original = {"PUBLIC_ORIGIN": "https://retired.example", "CORS_ORIGINS": "https://retired.example",
                    "CADDY_SITE_ADDRESS": "retired.example", "PUBLIC_ALIAS_ORIGINS": "https://retired.example", "JWT_SECRET": "untouched"}
        actual = cutover.environment_for(original, "https://agritrace.dev", "http://13.140.170.166")
        self.assertEqual(actual["PUBLIC_ORIGIN"], "https://agritrace.dev")
        self.assertEqual(actual["CORS_ORIGINS"], "http://13.140.170.166,https://agritrace.dev,https://www.agritrace.dev")
        self.assertNotIn("retired.example", str(actual))
        self.assertEqual(actual["JWT_SECRET"], "untouched")
        with self.assertRaises(ValueError):
            cutover.environment_for(original, "https://agritrace.dev/path", "http://13.140.170.166")

    def test_model_guard_rejects_database_or_worker_changes(self):
        before = {"services": {"api": {"environment": {"CORS_ORIGIN": "old", "PUBLIC_TRACE_BASE_URL": "old"}},
                  "web": {"image": "old"}, "proxy": {"environment": {"CADDY_SITE_ADDRESS": "old"}, "volumes": [{"target": "/etc/caddy/Caddyfile", "source": "old", "read_only": True}]},
                  "worker": {"image": "api", "volumes": ["identity:ro"]}, "postgres": {"volumes": ["durable"]}}}
        after = copy.deepcopy(before)
        after["services"]["web"]["image"] = "new"
        cutover.model_guard(before, after)
        for service, field in (("worker", "image"), ("postgres", "volumes")):
            unsafe = copy.deepcopy(after)
            unsafe["services"][service][field] = "changed"
            with self.assertRaises(ValueError):
                cutover.model_guard(before, unsafe)

    def test_qr_sql_quotes_existing_values(self):
        self.assertEqual(cutover.sql_string("value'with-quote"), "'value''with-quote'")

    def test_only_prisma_lock_line_endings_are_compatible(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new = Path(temporary) / "old", Path(temporary) / "new"
            relative = Path("apps/api/prisma/migrations/migration_lock.toml")
            for root in (old, new):
                (root / relative).parent.mkdir(parents=True)
            (old / relative).write_bytes(b'provider = "postgresql"\r\n')
            (new / relative).write_bytes(b'provider = "postgresql"\n')
            cutover.verify_business_source(old, new)
            (new / relative).write_bytes(b'provider = "sqlite"\n')
            with self.assertRaises(ValueError):
                cutover.verify_business_source(old, new)
            (new / relative).write_bytes(b'provider = "postgresql"\n')
            for root in (old, new):
                (root / "apps/api/src").mkdir(parents=True)
            (old / "apps/api/src/auth.ts").write_bytes(b"original\n")
            (new / "apps/api/src/auth.ts").write_bytes(b"changed\n")
            with self.assertRaises(ValueError):
                cutover.verify_business_source(old, new)

    def test_proxy_line_endings_do_not_allow_policy_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            old, new = Path(temporary) / "old", Path(temporary) / "new"
            for root in (old, new):
                (root / "deploy").mkdir(parents=True)
            (old / "deploy/Caddyfile.uat").write_bytes(b"{$CADDY_SITE_ADDRESS} {\r\n respond /api/docs 404\r\n}\r\n")
            (new / "deploy/Caddyfile.uat").write_bytes(b"{$CADDY_SITE_ADDRESS} {\n respond /api/docs 404\n}\n")
            cutover.verify_proxy_policy(old, new)
            (new / "deploy/Caddyfile.uat").write_bytes(b"{$CADDY_SITE_ADDRESS} {\n respond /api/docs 200\n}\n")
            with self.assertRaises(ValueError):
                cutover.verify_proxy_policy(old, new)


if __name__ == "__main__":
    unittest.main()
