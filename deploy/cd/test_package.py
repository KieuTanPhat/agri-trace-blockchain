import contextlib
import io
import json
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

from package import package
from policy import CONTROLLER_FILES, PolicyError, extract, sha256


class TrustedHelpers(unittest.TestCase):
    def test_bundle_pins_every_installed_helper_to_committed_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            files = {
                "docker-compose.uat.yml": "services: {}\n",
                "docker-compose.uat-https.yml": "services: {}\n",
                "docker-compose.uat-fabric.yml": "services: {}\n",
                "deploy/Caddyfile.uat": ":80 {}\n",
                "apps/api/prisma/migrations/20260101_init/migration.sql": "CREATE TABLE x (id INT);\n",
                "blockchain/chaincode/src/index.ts": "export {};\n",
            }
            files.update({f"deploy/cd/{name}": f"committed helper {name}\n" for name in CONTROLLER_FILES})
            for name, value in files.items():
                filename = root / name
                filename.parent.mkdir(parents=True, exist_ok=True)
                filename.write_bytes(value.encode())
            for args in (("init", "--quiet"), ("add", "."),
                         ("-c", "user.name=Deploy test", "-c", "user.email=deploy@test.invalid", "commit", "--quiet", "-m", "fixture")):
                subprocess.run(["git", "-C", str(root), *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
            # Dirty working bytes cannot silently change controller expectations.
            (root / "deploy/cd/session-auth.mjs").write_text("uncommitted helper")
            dist = root / "dist"
            dist.mkdir()
            (dist / "index.js").write_text("export {};\n")
            archive = root / "release.tar.gz"
            repository, origin = "test/agritrace", "https://agritrace.dev"
            with contextlib.chdir(root), contextlib.redirect_stdout(io.StringIO()):
                package(sha, f"ghcr.io/{repository}/api@sha256:{'a' * 64}",
                        f"ghcr.io/{repository}/web@sha256:{'b' * 64}", repository, origin, dist, archive)
            manifest = extract(archive, root / "validated", sha, repository, origin)
            self.assertEqual(manifest["controller"], {
                name: sha256(files[f"deploy/cd/{name}"].encode()) for name in CONTROLLER_FILES})
            self.assertNotIn("deploy/cd/session-auth.mjs", manifest["files"])
            # A candidate cannot omit the trusted helper metadata.
            with tarfile.open(archive) as source:
                contents = {entry.name: source.extractfile(entry).read() for entry in source}
            changed = json.loads(contents["cd-manifest.json"])
            del changed["controller"]["session-auth.mjs"]
            contents["cd-manifest.json"] = json.dumps(changed).encode()
            with tarfile.open(root / "incomplete.tar.gz", "w:gz") as target:
                for name, data in contents.items():
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    target.addfile(entry, io.BytesIO(data))
            with self.assertRaisesRegex(PolicyError, "Controller version"):
                extract(root / "incomplete.tar.gz", root / "rejected", sha, repository, origin)


if __name__ == "__main__":
    unittest.main()
