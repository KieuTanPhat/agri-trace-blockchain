import copy
import importlib.util
import sys
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


if __name__ == "__main__":
    unittest.main()
