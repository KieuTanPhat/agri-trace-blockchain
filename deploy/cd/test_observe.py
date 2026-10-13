import datetime
import http.server
import importlib.util
import json
import os
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cd_observe", Path(__file__).with_name("observe.py"))
observe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observe)

SHA_A = "a" * 40
SHA_B = "b" * 40
START = datetime.datetime(2026, 10, 14, 0, 0, tzinfo=datetime.timezone.utc)


def sample(minute, release=SHA_A, ok=True, image="sha256:one", restarts=0, started="2026-10-13T00:00:00Z", oom=False):
    moment = START + datetime.timedelta(minutes=minute)
    container = {"name": "api", "kind": "container", "ok": ok, "ms": 5,
                 "detail": {"status": "running", "oomKilled": oom, "restartCount": restarts, "startedAt": started, "image": image}}
    return {"v": 1, "t": observe.stamp(moment), "_t": moment, "release": release, "ok": ok, "probes": [container]}


def day(**overrides):
    return [sample(minute, **overrides) for minute in range(0, 24 * 60 + 1)]


def end_after(samples, minutes=0):
    return samples[-1]["_t"] + datetime.timedelta(minutes=minutes)


class Window(unittest.TestCase):
    def test_a_complete_quiet_day_passes(self):
        samples = day()
        result = observe.evaluate(samples, end=end_after(samples, 1))
        self.assertTrue(result["pass"], result["reasons"])
        self.assertEqual(result["windowSamples"], len(samples))
        self.assertLessEqual(result["longestGapSeconds"], 120)

    def test_a_short_window_is_not_acceptance(self):
        samples = day()[:600]
        result = observe.evaluate(samples, end=end_after(samples, 1))
        self.assertFalse(result["pass"])
        self.assertTrue(any("below the required" in reason for reason in result["reasons"]))

    def test_a_missing_stretch_longer_than_five_minutes_fails_and_a_short_one_passes(self):
        samples = day()
        short = [s for s in samples if not 100 <= int(s["t"][14:16]) + 60 * int(s["t"][11:13]) <= 103]
        self.assertTrue(observe.evaluate(short, end=end_after(samples, 1))["pass"])
        long = [s for s in samples if not 100 <= int(s["t"][14:16]) + 60 * int(s["t"][11:13]) <= 106]
        result = observe.evaluate(long, end=end_after(samples, 1))
        self.assertFalse(result["pass"])
        self.assertGreater(result["longestGapSeconds"], 300)
        self.assertEqual(len(result["gaps"]), 1)

    def test_a_stopped_collector_counts_as_a_gap_up_to_the_report_time(self):
        samples = day()
        result = observe.evaluate(samples, end=end_after(samples, 30))
        self.assertFalse(result["pass"])
        self.assertEqual(result["longestGapSeconds"], 30 * 60)

    def test_a_failed_probe_fails_unless_explicitly_allowed(self):
        samples = day()
        samples[500] = sample(500, ok=False)
        self.assertFalse(observe.evaluate(samples, end=end_after(samples, 1))["pass"])
        self.assertTrue(observe.evaluate(samples, end=end_after(samples, 1), allowed_failures=1)["pass"])

    def test_restart_and_oom_inside_one_release_are_unexpected(self):
        samples = day()
        for index in range(700, len(samples)):
            samples[index] = sample(index, restarts=1, started="2026-10-14T11:40:00Z")
        restarted = observe.evaluate(samples, end=end_after(samples, 1))
        self.assertFalse(restarted["pass"])
        self.assertEqual(restarted["restartEvents"][0]["reason"], "restarted")
        samples = day()
        samples[800] = sample(800, oom=True, ok=False)
        oom = observe.evaluate(samples, end=end_after(samples, 1))
        self.assertEqual(oom["restartEvents"][0]["reason"], "oom-killed")

    def test_a_release_or_image_change_starts_a_new_window_with_its_own_clock(self):
        old = [sample(minute) for minute in range(0, 600)]
        new = [sample(minute, release=SHA_B, image="sha256:two") for minute in range(600, 1441)]
        samples = old + new
        result = observe.evaluate(samples, end=end_after(samples, 1), min_hours=10)
        self.assertTrue(result["pass"], result["reasons"])
        self.assertEqual(result["release"], SHA_B)
        self.assertEqual(result["windowStart"], new[0]["t"])
        self.assertEqual(result["previousChanges"][0]["release"], SHA_B)
        self.assertFalse(observe.evaluate(samples, end=end_after(samples, 1), min_hours=24)["pass"])

    def test_empty_corrupt_and_out_of_order_ledgers_are_not_accepted(self):
        self.assertFalse(observe.evaluate([])["pass"])
        samples = day()
        self.assertIn("1 unreadable ledger line(s)", observe.evaluate(samples, corrupt=1, end=end_after(samples, 1))["reasons"])
        samples[10], samples[11] = samples[11], samples[10]
        reordered = observe.evaluate(samples, end=end_after(samples, 1))
        self.assertFalse(reordered["pass"])
        self.assertEqual(reordered["clockRegressions"], 1)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200 if self.path == "/ok" else 503)
        self.end_headers()

    def log_message(self, *args):
        pass


class Collector(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.addCleanup(self.directory.cleanup)

    def config(self, **extra):
        path = self.root / "collector.json"
        path.write_text(json.dumps(extra), encoding="utf-8")
        return path

    def test_http_probe_records_status_and_health(self):
        config = observe.load_config(self.config(http=[
            {"name": "up", "url": f"http://127.0.0.1:{self.port}/ok"},
            {"name": "down", "url": f"http://127.0.0.1:{self.port}/bad"}]))
        sample = observe.collect(config)
        by_name = {probe["name"]: probe for probe in sample["probes"]}
        self.assertTrue(by_name["up"]["ok"])
        self.assertEqual(by_name["down"]["detail"]["status"], 503)
        self.assertFalse(sample["ok"])

    def test_an_unreachable_endpoint_is_a_failed_sample_not_an_exception(self):
        config = observe.load_config(self.config(http=[{"name": "gone", "url": "http://127.0.0.1:9/ok", "timeoutSeconds": 1}]))
        sample = observe.collect(config)
        self.assertFalse(sample["ok"])
        self.assertIn("error", sample["probes"][0]["detail"])

    def test_release_file_must_hold_a_full_sha(self):
        release = self.root / "RELEASE"
        release.write_text(SHA_A + "\n", encoding="utf-8")
        config = observe.load_config(self.config(release={"file": str(release)}))
        self.assertEqual(observe.collect(config)["release"], SHA_A)
        release.write_text("main\n", encoding="utf-8")
        sample = observe.collect(config)
        self.assertIsNone(sample["release"])
        self.assertFalse(sample["ok"])

    def test_container_probe_reports_oom_restarts_and_unhealthy_state(self):
        inspected = [{"RestartCount": 3, "Image": "sha256:one",
                      "State": {"Status": "running", "OOMKilled": False, "StartedAt": "2026-10-14T00:00:00Z",
                                "Health": {"Status": "healthy"}}}]
        config = observe.load_config(self.config(containers=[{"name": "api", "container": "agri-api"}]))
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(inspected), "")):
            probe = observe.collect(config)["probes"][0]
        self.assertTrue(probe["ok"])
        self.assertEqual(probe["detail"]["restartCount"], 3)
        inspected[0]["State"]["OOMKilled"] = True
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(inspected), "")):
            self.assertFalse(observe.collect(config)["probes"][0]["ok"])
        inspected[0]["State"].update(OOMKilled=False, Health={"Status": "unhealthy"})
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, json.dumps(inspected), "")):
            self.assertFalse(observe.collect(config)["probes"][0]["ok"])

    def test_command_probe_enforces_limits_and_drops_non_scalar_output(self):
        config = observe.load_config(self.config(commands=[
            {"name": "outbox", "argv": ["probe"], "max": {"deadLetter": 0, "integrityErrors": 0}}]))
        output = json.dumps({"deadLetter": 0, "integrityErrors": 0, "pending": 2, "nested": {"secret": "x"}})
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, output, "")) as run:
            probe = observe.collect(config)["probes"][0]
        self.assertTrue(probe["ok"])
        self.assertNotIn("nested", probe["detail"])
        self.assertIs(run.call_args.kwargs["shell"], False)
        bad = json.dumps({"deadLetter": 1, "integrityErrors": 0})
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, bad, "")):
            failed = observe.collect(config)["probes"][0]
        self.assertFalse(failed["ok"])
        self.assertEqual(failed["detail"]["exceeded"], ["deadLetter"])
        missing = json.dumps({"deadLetter": 0})
        with patch.object(observe.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, missing, "")):
            self.assertEqual(observe.collect(config)["probes"][0]["detail"]["exceeded"], ["integrityErrors"])

    def test_configuration_rejects_credentials_shell_strings_and_duplicates(self):
        for bad in ({"http": [{"name": "a", "url": "http://user:pw@127.0.0.1/ok"}]},
                    {"http": [{"name": "a", "url": "ftp://127.0.0.1/ok"}]},
                    {"commands": [{"name": "a", "argv": "docker ps"}]},
                    {"commands": [{"name": "a", "argv": []}]},
                    {"http": [{"name": "A B", "url": "http://127.0.0.1/ok"}]},
                    {"http": [{"name": "a", "url": "http://127.0.0.1/ok"}, {"name": "a", "url": "http://127.0.0.1/ok"}]},
                    {}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                observe.load_config(self.config(**bad))

    def test_ledger_is_append_only_private_and_refuses_symbolic_links(self):
        ledger = self.root / "ledger.jsonl"
        sample = {"v": 1, "t": "2026-10-14T00:00:00Z", "release": SHA_A, "ok": True, "probes": []}
        observe.append_sample(ledger, sample)
        observe.append_sample(ledger, {**sample, "t": "2026-10-14T00:01:00Z"})
        samples, corrupt = observe.read_ledger(ledger)
        self.assertEqual((len(samples), corrupt), (2, 0))
        if os.name != "nt":
            self.assertEqual(ledger.stat().st_mode & 0o777, 0o600)
            link = self.root / "link.jsonl"
            link.symlink_to(ledger)
            with self.assertRaises(ValueError):
                observe.append_sample(link, sample)
        with ledger.open("a", encoding="utf-8") as handle:
            handle.write("not json\n")
        self.assertEqual(observe.read_ledger(ledger)[1], 1)

    def test_cli_collects_then_reports_a_short_window_as_not_accepted(self):
        ledger = self.root / "ledger.jsonl"
        config = self.config(http=[{"name": "up", "url": f"http://127.0.0.1:{self.port}/ok"}])
        self.assertEqual(observe.main(["collect", "--config", str(config), "--ledger", str(ledger)]), 0)
        self.assertEqual(observe.main(["report", "--ledger", str(ledger)]), 1)
        self.assertEqual(observe.main(["report", "--ledger", str(self.root / "missing.jsonl")]), 2)


if __name__ == "__main__":
    unittest.main()
