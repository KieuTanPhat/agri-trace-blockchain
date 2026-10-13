import hashlib
import json
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from controller import Controller, PolicyError


@unittest.skipIf(os.name == "nt", "Snapshot commands and durable directory fsync require Linux")
class HybridSnapshot(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        (self.base / "backups").mkdir()
        (self.base / "cd").mkdir()
        self.pins = self.base / "shared/hybrid/legacy-scope-pins.json"
        self.pins.parent.mkdir(parents=True)
        self.content = b'{"schema":"agritrace-legacy-scope-pins-1", "pins":[]}\n'
        self.pins.write_bytes(self.content)
        self.pins.chmod(0o644)
        env = self.base / ".env"
        env.write_text("PUBLIC_ORIGIN=https://agritrace.dev\nPOSTGRES_USER=fixture\nPOSTGRES_DB=fixture\n"
                       f"HYBRID_LEGACY_MANIFEST_PINS_HOST={self.pins}\n", encoding="utf-8")
        (self.base / "accounts.json").write_text("[]", encoding="utf-8")
        self.controller = Controller({"base": str(self.base), "env": str(env),
                                      "accounts": str(self.base / "accounts.json"),
                                      "backup_certificate": str(self.base / "backup.crt")})
        # PostgreSQL is represented by a bounded synthetic dump. Tar, CMS
        # encryption, decryption and checksum validation below are real.
        self.controller.dc = MagicMock(return_value=[sys.executable, "-c",
                                                     "import sys;sys.stdout.buffer.write(b'PGDMPisolated')"])
        self.previous = {"id": "prod-" + "a" * 40, "manifest": {"migrations": {}}}

    def test_first_floor_snapshot_recovers_exact_independent_pin_bytes(self):
        key = self.base / "backup.key"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
                        "-subj", "/CN=isolated-backup-test", "-keyout", str(key),
                        "-out", str(self.base / "backup.crt")], check=True, capture_output=True)
        directory = Path(self.controller.target_snapshot(self.previous, "b" * 40, {"fingerprints": {}}))
        self.assertFalse((directory / "snapshot.tar").exists())
        decoded = self.base / "decoded.tar"
        subprocess.run(["openssl", "cms", "-decrypt", "-binary", "-inform", "DER",
                        "-in", str(directory / "snapshot.cms"), "-recip", str(self.base / "backup.crt"),
                        "-inkey", str(key), "-out", str(decoded)], check=True, capture_output=True)
        with tarfile.open(decoded) as archive:
            checksums = json.load(archive.extractfile("checksums.json"))
            recovered = {name: archive.extractfile(name).read() for name in checksums}
        self.assertTrue(all(hashlib.sha256(value).hexdigest() == checksums[name]
                            for name, value in recovered.items()))
        self.assertEqual(recovered["legacy-scope-pins.json"], self.content)
        metadata = json.loads(recovered["hybrid-metadata.json"])
        self.assertEqual(metadata["sha256"], hashlib.sha256(self.content).hexdigest())
        self.assertEqual(metadata["source"], str(self.pins))
        self.assertEqual(metadata["attemptSha"], "b" * 40)
        reference = self.controller.snapshot_reference(str(directory), "b" * 40)
        self.assertEqual(reference["sourceSha"], "b" * 40)
        self.assertEqual(reference["encryptedSha256"], hashlib.sha256((directory / "snapshot.cms").read_bytes()).hexdigest())
        (directory / "legacy-scope-pins.json").write_bytes(self.content + b" ")
        with self.assertRaisesRegex(PolicyError, "checksum differs"):
            self.controller.snapshot_reference(str(directory), "b" * 40)
        (directory / "legacy-scope-pins.json").write_bytes(self.content)
        # Simulate a new host with no previous shared file. Do not obtain the
        # trust pins from restored PostgreSQL or copy a stale absolute path.
        self.pins.unlink()
        restored = self.base / "isolated-restored/shared/hybrid/legacy-scope-pins.json"
        restored.parent.mkdir(parents=True)
        restored.write_bytes(recovered[metadata["file"]])
        restored.chmod(int(metadata["restoreMode"], 8))
        self.assertEqual(restored.read_bytes(), self.content)
        self.assertEqual(restored.stat().st_mode & 0o777, 0o644)

    def test_invalid_or_missing_pin_file_blocks_snapshot_before_database_access(self):
        self.controller.run = MagicMock()
        self.pins.unlink()
        with self.assertRaisesRegex(PolicyError, "regular"):
            self.controller.target_snapshot(self.previous, "b" * 40, {})
        self.controller.run.assert_not_called()

    def test_symlink_cannot_substitute_snapshot_authority(self):
        original = self.pins.with_name("original.json")
        self.pins.rename(original)
        self.pins.symlink_to(original)
        self.controller.run = MagicMock()
        with self.assertRaisesRegex(PolicyError, "regular"):
            self.controller.target_snapshot(self.previous, "b" * 40, {})
        self.controller.run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
