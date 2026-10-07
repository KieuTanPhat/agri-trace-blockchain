import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from policy import PolicyError, command, sha256, fingerprint, extract, additive_sql, migrations, approved_package, ci_gate, registry_auth

SHA = "a" * 40
REPO = "KieuTanPhat/agri-trace-blockchain"
ORIGIN = "http://13.140.170.166"


def bundle(directory, extra=None, mutate=None):
    files = {"docker-compose.uat.yml": b"services: {}", "docker-compose.uat-fabric.yml": b"services: {}",
             "deploy/Caddyfile.uat": b":80 {}", "blockchain/chaincode/src/index.ts": b"export {}",
             "blockchain/chaincode/dist/index.js": b"module.exports={}", "apps/api/prisma/migrations/20260101000000_init/migration.sql": b"CREATE TABLE x (id INT);"}
    hashes = {name: sha256(data) for name, data in files.items()}
    manifest = {"format": 1, "sha": SHA, "repository": REPO, "origin": ORIGIN, "files": hashes, "chaincode": fingerprint(hashes),
                "migrations": {"20260101000000_init": hashes["apps/api/prisma/migrations/20260101000000_init/migration.sql"]},
                "api": f"ghcr.io/{REPO.lower()}/api@sha256:{'0' * 64}", "web": f"ghcr.io/{REPO.lower()}/web@sha256:{'1' * 64}"}
    manifest["controller"] = {name: "0" * 64 for name in ("controller.py", "policy.py", "verify.mjs", "entry")}
    if mutate:
        mutate(manifest)
    files["cd-manifest.json"] = json.dumps(manifest).encode()
    archive = Path(directory) / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        if extra:
            info = tarfile.TarInfo(extra[0])
            if extra[1] == "link":
                info.type = tarfile.SYMTYPE
                info.linkname = "/etc/passwd"
                tar.addfile(info)
            else:
                info.size = len(extra[1])
                tar.addfile(info, io.BytesIO(extra[1]))
    return archive


class Policies(unittest.TestCase):
    def test_historical_platform_line_endings_match_without_accepting_sql_changes(self):
        name = "20260101_init"
        lf = b'CREATE TABLE "example" ("id" INTEGER);\n-- original history\n'
        crlf = lf.replace(b"\n", b"\r\n")
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "apps/api/prisma/migrations" / name / "migration.sql"
            target.parent.mkdir(parents=True)
            for source, recorded in ((lf, crlf), (crlf, lf)):
                target.write_bytes(source)
                applied = {name: sha256(recorded)}
                self.assertEqual(migrations(applied, {name: sha256(source)}, directory), [])
                self.assertEqual(applied, {name: sha256(recorded)})
                self.assertEqual(target.read_bytes(), source)
            for changed in (lf.replace(b"INTEGER", b"BIGINT"), lf.rstrip(b"\n"), lf + b"-- edited\n"):
                target.write_bytes(changed)
                with self.assertRaisesRegex(PolicyError, "Applied migration checksum was modified"):
                    migrations({name: sha256(crlf)}, {name: sha256(changed)}, directory)
            target.write_bytes(lf.replace(b"INTEGER", b"BIGINT"))
            with self.assertRaisesRegex(PolicyError, "Migration source checksum mismatch"):
                migrations({name: sha256(crlf)}, {name: sha256(lf)}, directory)

    def test_opaque_job_credentials_support_long_tokens_without_logging_them(self):
        for username in ("KieuTanPhat", "github-actions[bot]"):
            registry_auth({"username": username, "token": "ghs_" + "A" * 1500})
        for auth in (None, {}, {"username": "", "token": "A" * 32},
                     {"username": "-option", "token": "A" * 32},
                     {"username": "KieuTanPhat", "token": "A" * 8193},
                     {"username": "KieuTanPhat", "token": "A" * 32 + "\n"},
                     {"username": "KieuTanPhat", "token": "A" * 32 + "\x00"}):
            with self.assertRaises(PolicyError) as failure:
                registry_auth(auth)
            self.assertNotIn("A" * 16, str(failure.exception))

    def test_real_fabric_approved_package_shape(self):
        package_id = "agritrace_1.0:" + "a" * 64
        self.assertEqual(approved_package({"source": {"Type": {"LocalPackage": {"package_id": package_id}}}}), package_id)
        with self.assertRaises(PolicyError):
            approved_package({"source": {}})

    def test_server_ci_gate_blocks_stale_pr_failed_and_missing_runs(self):
        runs = [{"id": index, "head_sha": SHA, "head_branch": "main", "event": "push", "path": f".github/workflows/{name}",
                 "status": "completed", "conclusion": "success"} for index, name in enumerate(("application-ci.yml", "blockchain-ci.yml", "dependency-audit.yml"))]
        ci_gate(runs, SHA, SHA)
        for invalid in (runs[:2], [dict(run, event="pull_request") for run in runs], [dict(run, conclusion="failure") for run in runs]):
            with self.assertRaises(PolicyError):
                ci_gate(invalid, SHA, SHA)
        with self.assertRaises(PolicyError):
            ci_gate(runs, SHA, "b" * 40)

    def test_commands(self):
        self.assertEqual(command(f"upgrade {SHA} {'b' * 64} 1")[0], "upgrade")
        for value in ("bash", "status; id", "status\nwhoami", "rollback ../../etc", f"deploy {SHA} {'b' * 64} ;id", f"upgrade {SHA} {'b' * 64} 0"):
            with self.subTest(value=value), self.assertRaises(PolicyError):
                command(value)

    def test_good_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            result = extract(bundle(directory), Path(directory) / "release", SHA, REPO, ORIGIN)
            self.assertEqual(result["sha"], SHA)

    def test_no_path_traversal_links_credentials_or_duplicate_members(self):
        for extra in (("../escape", b"x"), ("/etc/passwd", b"x"), ("deploy/Caddyfile.uat", b"duplicate"),
                      ("blockchain/chaincode/src/link.ts", "link"), (".env.uat", b"secret")):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                destination = Path(directory) / "release"
                with self.assertRaises(PolicyError):
                    extract(bundle(directory, extra=extra), destination, SHA, REPO, ORIGIN)
                self.assertFalse(destination.exists())

    def test_wrong_sha_digest_origin_or_hash_is_rejected_before_extract(self):
        for mutation in (lambda m: m.update(sha="b" * 40), lambda m: m.update(origin="http://other"),
                         lambda m: m.update(api="agri-trace-api:latest"), lambda m: m["files"].update({"deploy/Caddyfile.uat": "0" * 64})):
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(PolicyError):
                    extract(bundle(directory, mutate=mutation), Path(directory) / "release", SHA, REPO, ORIGIN)

    def test_additive_migrations(self):
        additive_sql('-- comment\nCREATE TABLE "extra" ("id" UUID PRIMARY KEY, "note" TEXT); CREATE INDEX "ix_note" ON "extra"("note"); ALTER TABLE "lot" ADD COLUMN "memo" VARCHAR(255);')

    def test_non_compatible_or_disguised_sql_is_blocked(self):
        for sql in ('DROP TABLE lot;', 'ALTER TABLE lot DROP COLUMN x;', 'ALTER TABLE lot ADD COLUMN x TEXT NOT NULL;',
                    'ALTER TABLE lot ADD COLUMN x INT DEFAULT 0;', 'DELETE FROM trace_event;', 'CREATE UNIQUE INDEX x ON lot(x);',
                    'DO $$ BEGIN END $$;', '/* fake create */ UPDATE lot SET x=0;', 'ALTER TABLE lot ADD COLUMN x INT; DROP TABLE lot;',
                    'CREATE TABLE copy AS SELECT * FROM lot;', "CREATE TABLE x (note TEXT DEFAULT 'a;b'); DELETE FROM lot;", ''):
            with self.subTest(sql=sql), self.assertRaises(PolicyError):
                additive_sql(sql)

    def test_applied_migrations_cannot_be_removed_or_edited(self):
        for candidate in ({}, {"20260101_init": "b" * 64}):
            with self.assertRaises(PolicyError):
                migrations({"20260101_init": "a" * 64}, candidate, ".")

    def test_append_and_rollback_compatibility(self):
        with tempfile.TemporaryDirectory() as directory:
            sql = 'ALTER TABLE "lot" ADD COLUMN "memo" TEXT;'
            target = Path(directory) / "apps/api/prisma/migrations/20260102_note/migration.sql"
            target.parent.mkdir(parents=True)
            target.write_text(sql)
            old = {"20260101_init": "a" * 64}
            new = dict(old, **{"20260102_note": sha256(sql.encode())})
            self.assertEqual(migrations(old, new, directory), ["20260102_note"])
            self.assertEqual(migrations(new, old, directory, ["20260102_note"]), [])


if __name__ == "__main__":
    unittest.main()
