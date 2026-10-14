import importlib.util
import contextlib
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cd_installer", Path(__file__).with_name("install-target.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
PolicyError = installer.policy.PolicyError


class RetiredInstallation(unittest.TestCase):
    def test_schema_two_transition_command_is_rejected_before_reading_or_changing_config(self):
        with patch("sys.argv", ["install-target.py", "fresh-install", "--environment", "production"]), \
                contextlib.redirect_stderr(io.StringIO()), patch.object(installer, "config_path") as config, \
                patch.object(installer, "update_controller") as update:
            with self.assertRaises(SystemExit) as exit:
                installer.main()
        self.assertEqual(exit.exception.code, 2)
        config.assert_not_called()
        update.assert_not_called()


@unittest.skipIf(os.name == "nt", "Administrator deployment locking uses Linux flock")
class AdministratorLock(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        (self.base / "cd").mkdir()

    def test_running_delivery_blocks_installer_before_configuration_changes(self):
        import fcntl
        with (self.base / "cd/delivery.lock").open("a") as delivery, patch.object(installer.os, "getuid", return_value=0):
            fcntl.flock(delivery, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaisesRegex(PolicyError, "Another delivery is running"):
                with installer.administrator_lock(self.base):
                    self.fail("Installer entered while a delivery was running")

    def test_interrupted_delivery_requires_recovery(self):
        (self.base / "cd/journal.json").write_text("{}")
        with patch.object(installer.os, "getuid", return_value=0):
            with self.assertRaisesRegex(PolicyError, "Recover interrupted"):
                with installer.administrator_lock(self.base):
                    self.fail("Installer entered with a recovery journal")

    def test_exception_releases_lock_and_non_administrator_is_rejected(self):
        with patch.object(installer.os, "getuid", return_value=0):
            with self.assertRaisesRegex(RuntimeError, "simulated"):
                with installer.administrator_lock(self.base):
                    raise RuntimeError("simulated")
            with installer.administrator_lock(self.base):
                pass
        with patch.object(installer.os, "getuid", return_value=1000):
            with self.assertRaisesRegex(PolicyError, "administrator"):
                with installer.administrator_lock(self.base):
                    self.fail("Non-administrator acquired the lock")


@unittest.skipIf(os.name == "nt", "Controller installation relies on POSIX symlink and rename semantics")
class ControllerUpdate(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        self.library = root / "lib"
        self.library.mkdir()
        self.versions = self.library / "prod-versions"

    def source(self, label):
        directory = Path(tempfile.mkdtemp(dir=self.library.parent))
        for name in installer.policy.CONTROLLER_FILES:
            (directory / name).write_text(f"{label} {name}\n")
        return directory, installer.controller_digest(directory)[0]

    def update(self, source, digest):
        return installer.update_controller("production", source, digest, self.library)

    def installed(self):
        link = self.library / "prod"
        self.assertTrue(link.is_symlink())
        return Path(os.readlink(link))

    def test_update_installs_an_immutable_digest_directory_and_switches_by_symlink(self):
        source, digest = self.source("v1")
        result = self.update(source, digest)
        self.assertEqual(result, {"result": "controller-updated", "environment": "production", "digest": digest, "previous": None})
        self.assertEqual(self.installed(), self.versions / digest)
        for name in installer.policy.CONTROLLER_FILES:
            self.assertEqual((self.library / "prod" / name).read_text(), f"v1 {name}\n")
        self.assertEqual(installer.controller_digest(self.library / "prod")[0], digest)

    def test_a_digest_that_was_not_reviewed_changes_nothing(self):
        source, digest = self.source("v1")
        for wrong in (None, "", "a" * 63, "g" * 64, "0" * 64):
            with self.subTest(wrong=wrong), self.assertRaises(PolicyError):
                self.update(source, wrong)
        self.assertFalse((self.library / "prod").exists() or (self.library / "prod").is_symlink())
        self.assertFalse(self.versions.exists())

    def test_first_update_preserves_the_plain_directory_and_restore_returns_to_it(self):
        plain = self.library / "prod"
        plain.mkdir()
        for name in installer.policy.CONTROLLER_FILES:
            (plain / name).write_text("plain controller\n")
        source, digest = self.source("v1")
        result = self.update(source, digest)
        self.assertTrue(result["previous"].startswith("plain-"))
        self.assertEqual(self.installed(), self.versions / digest)
        restored = installer.restore_controller("production", self.library)
        self.assertEqual(restored["result"], "controller-restored")
        self.assertEqual(restored["replaced"], digest)
        self.assertEqual((self.library / "prod" / "controller.py").read_text(), "plain controller\n")

    def test_second_update_keeps_the_previous_version_and_restore_switches_back(self):
        first, first_digest = self.source("v1")
        second, second_digest = self.source("v2")
        self.update(first, first_digest)
        result = self.update(second, second_digest)
        self.assertEqual(result["previous"], first_digest)
        self.assertEqual(self.installed(), self.versions / second_digest)
        self.assertEqual(installer.restore_controller("production", self.library)["digest"], first_digest)
        self.assertEqual(self.installed(), self.versions / first_digest)
        self.assertEqual(installer.restore_controller("production", self.library)["digest"], second_digest)

    def test_failure_while_switching_leaves_the_old_controller_in_place(self):
        plain = self.library / "prod"
        plain.mkdir()
        (plain / "controller.py").write_text("plain controller\n")
        source, digest = self.source("v1")
        real = installer.os.replace

        def fail_switch(source_path, target):
            if Path(target) == self.library / "prod":
                raise OSError("simulated failure while switching")
            return real(source_path, target)

        with patch.object(installer.os, "replace", side_effect=fail_switch):
            with self.assertRaisesRegex(OSError, "simulated"):
                self.update(source, digest)
        self.assertFalse((self.library / "prod").is_symlink())
        self.assertEqual((self.library / "prod" / "controller.py").read_text(), "plain controller\n")
        self.assertFalse((self.library / "prod.next").is_symlink() or (self.library / "prod.next").exists())

    def test_marker_write_failure_restores_the_plain_directory_with_all_helpers(self):
        plain = self.library / "prod"
        plain.mkdir()
        for name in installer.policy.CONTROLLER_FILES:
            (plain / name).write_text("plain controller\n")
        (plain / "verify.mjs").write_text("historical helper\n")
        source, digest = self.source("v1")
        real = Path.write_text

        def fail_marker(path, *args, **kwargs):
            if path == self.versions / "previous.next":
                raise OSError("simulated marker write failure")
            return real(path, *args, **kwargs)

        with patch.object(Path, "write_text", fail_marker):
            with self.assertRaisesRegex(OSError, "marker write"):
                self.update(source, digest)
        self.assertFalse(plain.is_symlink())
        self.assertEqual((plain / "controller.py").read_text(), "plain controller\n")
        self.assertEqual((plain / "verify.mjs").read_text(), "historical helper\n")
        self.assertFalse((self.versions / "previous").exists())
        self.assertFalse((self.versions / "previous.next").exists())

    def test_marker_commit_failure_restores_the_link_and_keeps_the_previous_marker(self):
        first, first_digest = self.source("v1")
        second, second_digest = self.source("v2")
        third, third_digest = self.source("v3")
        self.update(first, first_digest)
        self.update(second, second_digest)
        marker = self.versions / "previous"
        before = marker.read_bytes()
        real = installer.os.replace

        def fail_marker(source_path, target):
            if Path(target) == marker:
                raise OSError("simulated marker commit failure")
            return real(source_path, target)

        with patch.object(installer.os, "replace", side_effect=fail_marker):
            with self.assertRaisesRegex(OSError, "marker commit"):
                self.update(third, third_digest)
        self.assertEqual(self.installed(), self.versions / second_digest)
        self.assertEqual(marker.read_bytes(), before)
        self.assertFalse((self.versions / "previous.next").exists())

    def test_an_installed_version_that_was_modified_is_never_reused(self):
        source, digest = self.source("v1")
        self.update(source, digest)
        (self.versions / digest / "policy.py").write_text("tampered\n")
        with self.assertRaisesRegex(PolicyError, "was modified"):
            self.update(source, digest)

    def test_restore_requires_a_recorded_and_intact_previous_version(self):
        with self.assertRaisesRegex(PolicyError, "No previous"):
            installer.restore_controller("production", self.library)
        first, first_digest = self.source("v1")
        second, second_digest = self.source("v2")
        self.update(first, first_digest)
        self.update(second, second_digest)
        (self.versions / first_digest / "policy.py").write_text("tampered\n")
        with self.assertRaisesRegex(PolicyError, "was modified"):
            installer.restore_controller("production", self.library)
        self.assertEqual(self.installed(), self.versions / second_digest)

    def test_a_partial_directory_from_an_interrupted_install_is_replaced(self):
        source, digest = self.source("v1")
        self.versions.mkdir()
        partial = self.versions / (digest + ".partial")
        partial.mkdir()
        (partial / "stale").write_text("left behind")
        self.update(source, digest)
        self.assertFalse(partial.exists())
        self.assertEqual(self.installed(), self.versions / digest)


if __name__ == "__main__":
    unittest.main()
