"""Kiểm ranh giới an toàn của công cụ Edge; Docker và health đều được mock."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

if os.name != "nt":
    spec = importlib.util.spec_from_file_location("edge_admin", Path(__file__).parents[1] / "edge/admin.py")
    edge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(edge)


@unittest.skipIf(os.name == "nt", "Edge administration requires Linux flock")
class EdgeAdministration(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name) / "edge"
        self.root.mkdir()
        self.delivery = self.root.parent / "delivery.lock"
        self.host = self.root.parent / "host.lock"
        self.environment = {
            "CADDY_IMAGE": "caddy:reviewed@sha256:" + "a" * 64,
            "EDGE_CONFIG_DIRECTORY": str(self.root / "config"),
            "EDGE_DATA_VOLUME": "agri-trace-uat_caddy-data",
            "EDGE_STATE_VOLUME": "agri-trace-uat_caddy-config",
        }
        self.write_environment()
        self.commands = []
        self.network = self.enterContext(patch.object(edge.subprocess, "run", return_value=SimpleNamespace(returncode=0)))
        self.docker = self.enterContext(patch.object(edge, "run", side_effect=self.command))
        self.health = self.enterContext(patch.object(edge, "health", side_effect=lambda: self.commands.append(("health",))))
        self.enterContext(patch.object(edge, "ROOT", self.root))
        self.enterContext(patch.object(edge.os, "getuid", return_value=0))
        self.enterContext(patch.object(edge.os, "umask"))
        self.enterContext(patch.object(edge, "config", return_value="reviewed Caddyfile\n"))

        def isolated_path(value):
            return {
                "/opt/agri-trace/cd/delivery.lock": self.delivery,
                "/run/lock/agri-trace-host.lock": self.host,
            }.get(str(value), Path(value))

        self.enterContext(patch.object(edge, "Path", side_effect=isolated_path))

    def write_environment(self):
        (self.root / ".env").write_text("".join(f"{key}={value}\n" for key, value in self.environment.items()))

    def command(self, *args):
        self.commands.append(args)
        return b""

    def invoke(self, operation):
        output = io.StringIO()
        with patch("sys.argv", ["admin.py", operation]), contextlib.redirect_stdout(output):
            edge.main()
        return json.loads(output.getvalue())

    def test_prepare_uses_existing_certificate_volumes_and_disposable_validation_storage(self):
        self.assertEqual(self.invoke("prepare"), {"result": "passed", "operation": "prepare", "project": "agritrace-edge"})
        self.assertEqual(self.commands[:2], [
            ("docker", "volume", "inspect", self.environment["EDGE_DATA_VOLUME"]),
            ("docker", "volume", "inspect", self.environment["EDGE_STATE_VOLUME"]),
        ])
        validate = self.commands[-1]
        self.assertIn("validate", validate)
        self.assertEqual(validate.count("--tmpfs"), 3)
        self.assertNotIn(self.environment["EDGE_DATA_VOLUME"], " ".join(validate))
        self.assertNotIn(self.environment["EDGE_STATE_VOLUME"], " ".join(validate))
        self.assertEqual((self.root / "config/Caddyfile").read_text(), "reviewed Caddyfile\n")
        self.assertEqual((self.root / "config/Caddyfile").stat().st_mode & 0o777, 0o644)
        self.assertTrue((self.root / "docker-compose.yml").is_file())
        self.assertFalse(any(command[1:3] == ("volume", "create") or command[1:3] == ("volume", "rm") for command in self.commands))
        self.health.assert_not_called()

    def test_prepare_creates_only_the_missing_production_ingress(self):
        self.network.return_value.returncode = 1
        self.invoke("prepare")
        self.assertIn(("docker", "network", "create", "agritrace-prod-ingress"), self.commands)
        self.assertFalse(any("agri-trace-uat-" in " ".join(command) for command in self.commands))

    def test_prepare_reads_volume_names_from_environment_instead_of_hardcoding_them(self):
        self.environment.update(EDGE_DATA_VOLUME="reviewed-data", EDGE_STATE_VOLUME="reviewed-state")
        self.write_environment()
        self.invoke("prepare")
        self.assertEqual(self.commands[0], ("docker", "volume", "inspect", "reviewed-data"))
        self.assertEqual(self.commands[1], ("docker", "volume", "inspect", "reviewed-state"))

    def test_prepare_missing_environment_or_key_changes_no_docker_resource(self):
        (self.root / ".env").unlink()
        with self.assertRaisesRegex(RuntimeError, "environment file is missing"):
            self.invoke("prepare")
        for key in self.environment.copy():
            with self.subTest(key=key):
                saved = self.environment.pop(key)
                self.write_environment()
                with self.assertRaisesRegex(RuntimeError, "lacks " + key):
                    self.invoke("prepare")
                self.environment[key] = saved
        self.docker.assert_not_called()
        self.network.assert_not_called()

    def test_prepare_missing_certificate_volume_stops_before_network_or_config_changes(self):
        self.docker.side_effect = subprocess.CalledProcessError(1, ["docker", "volume", "inspect"])
        with self.assertRaises(subprocess.CalledProcessError):
            self.invoke("prepare")
        self.assertFalse((self.root / "config").exists())
        self.assertFalse((self.root / "docker-compose.yml").exists())
        self.network.assert_not_called()

    def test_start_validates_before_starting_proxy_then_requires_health(self):
        self.invoke("start")
        self.assertIn("validate", self.commands[0])
        self.assertEqual(self.commands[1], tuple(edge.compose("up", "-d", "--no-build", "--pull", "never", "proxy")))
        self.assertEqual(self.commands[2], ("health",))

    def test_start_never_starts_an_invalid_config_and_never_masks_failed_health(self):
        with patch.object(edge, "validate", side_effect=RuntimeError("invalid Caddy config")):
            with self.assertRaisesRegex(RuntimeError, "invalid Caddy"):
                self.invoke("start")
        self.docker.assert_not_called()
        self.health.assert_not_called()
        self.health.side_effect = RuntimeError("failed health")
        with self.assertRaisesRegex(RuntimeError, "failed health"):
            self.invoke("start")

    def test_root_and_delivery_lock_are_required_before_docker_changes(self):
        with patch.object(edge.os, "getuid", return_value=1000):
            with self.assertRaisesRegex(RuntimeError, "requires root"):
                self.invoke("prepare")
        with self.delivery.open("a") as lock:
            edge.fcntl.flock(lock, edge.fcntl.LOCK_EX | edge.fcntl.LOCK_NB)
            with self.assertRaises(BlockingIOError):
                self.invoke("prepare")
        self.docker.assert_not_called()
        self.network.assert_not_called()

    def test_reload_restores_previous_config_when_health_fails(self):
        (self.root / "config").mkdir()
        filename = self.root / "config/Caddyfile"
        filename.write_text("old working config\n")
        self.health.side_effect = RuntimeError("failed health")
        with self.assertRaisesRegex(RuntimeError, "failed health"):
            self.invoke("reload")
        self.assertEqual(filename.read_text(), "old working config\n")
        reloads = [command for command in self.commands if "reload" in command]
        self.assertEqual(len(reloads), 2)
        self.assertEqual(reloads[0], reloads[1])


if __name__ == "__main__":
    unittest.main()
