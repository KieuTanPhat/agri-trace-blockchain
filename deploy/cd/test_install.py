import importlib.util
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("cd_installer", Path(__file__).with_name("install.py"))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


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
            with self.assertRaisesRegex(installer.policy.PolicyError, "Another delivery is running"):
                with installer.administrator_lock(self.base):
                    self.fail("Installer entered while a delivery was running")

    def test_interrupted_delivery_requires_recovery(self):
        (self.base / "cd/journal.json").write_text("{}")
        with patch.object(installer.os, "getuid", return_value=0):
            with self.assertRaisesRegex(installer.policy.PolicyError, "Recover interrupted"):
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
            with self.assertRaisesRegex(installer.policy.PolicyError, "administrator"):
                with installer.administrator_lock(self.base):
                    self.fail("Non-administrator acquired the lock")


if __name__ == "__main__":
    unittest.main()
