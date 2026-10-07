"""Fail-closed release policies. No Docker or network side effects."""
import hashlib
import json
import re
import tarfile
from pathlib import Path, PurePosixPath

SHA = re.compile(r"^[a-f0-9]{40}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
OPERATIONS = {"deploy", "upgrade", "rollback", "recover", "status", "backup"}
FIXED_FILES = {"docker-compose.uat.yml", "docker-compose.uat-fabric.yml", "deploy/Caddyfile.uat"}
MAX_AUTH_HEADER = 16 * 1024


class PolicyError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise PolicyError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def registry_auth(auth):
    require(isinstance(auth, dict), "Invalid registry authentication object")
    username, token = auth.get("username"), auth.get("token")
    require(isinstance(username, str) and bool(re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.\[\]-]{0,79}", username)),
            "Registry username is missing or invalid")
    # GitHub job credentials are opaque; bounded transport must not assume a
    # historical short token format. Neither errors nor logs include its value.
    require(isinstance(token, str) and 16 <= len(token) <= 8192 and all(33 <= ord(c) <= 126 for c in token),
            "Registry credential framing is invalid")


def approved_package(approved):
    value = approved.get("package_id") or approved.get("source", {}).get("Type", {}).get("LocalPackage", {}).get("package_id")
    require(isinstance(value, str) and bool(re.fullmatch(r"[a-zA-Z0-9_.-]+:[a-f0-9]{64}", value)), "Active chaincode package ID is unavailable")
    return value


def ci_gate(runs, sha, main_sha):
    require(sha == main_sha, "Candidate is no longer latest main")
    for filename in ("application-ci.yml", "blockchain-ci.yml", "dependency-audit.yml"):
        selected = sorted((run for run in runs if run.get("head_sha") == sha and run.get("head_branch") == "main" and
                           run.get("event") == "push" and run.get("path") == f".github/workflows/{filename}"), key=lambda run: run["id"], reverse=True)
        require(bool(selected) and selected[0].get("status") == "completed" and selected[0].get("conclusion") == "success",
                "Server requires three successful exact-main-push CI runs")


def command(value):
    # Deliberately no shell parsing/evaluation or user-supplied option flags.
    parts = value.split(" ")
    require(all(parts) and parts[0] in OPERATIONS, "Unsupported CD command")
    op = parts[0]
    expected = {"status": 1, "recover": 1, "rollback": 2, "backup": 2, "deploy": 3, "upgrade": 4}[op]
    require(len(parts) == expected, "Invalid CD command arguments")
    if expected > 1:
        require(bool(SHA.fullmatch(parts[1])), "Invalid commit SHA")
    if op in {"deploy", "upgrade"}:
        require(bool(DIGEST.fullmatch(parts[2])), "Invalid archive checksum")
    if op == "upgrade":
        require(bool(re.fullmatch(r"[1-9][0-9]{0,8}", parts[3])), "Invalid expected sequence")
    return parts


def image(value, repository, component):
    prefix = f"ghcr.io/{repository.lower()}/{component}@sha256:"
    require(isinstance(value, str) and value.startswith(prefix) and bool(DIGEST.fullmatch(value[len(prefix):])),
            "Expected an immutable image digest from this repository")


def allowed_file(name):
    if name in FIXED_FILES:
        return True
    if re.fullmatch(r"apps/api/prisma/migrations/[a-zA-Z0-9_-]+/migration.sql", name):
        return True
    if name == "apps/api/prisma/migrations/migration_lock.toml":
        return True
    if name in {f"blockchain/chaincode/{x}" for x in ("package.json", "package-lock.json", "tsconfig.json")}:
        return True
    return bool(re.fullmatch(r"blockchain/chaincode/(src|dist)/[a-zA-Z0-9_./-]+", name))


def fingerprint(files):
    selected = {k: v for k, v in files.items() if k.startswith("blockchain/chaincode/src/") or
                k in {f"blockchain/chaincode/{x}" for x in ("package.json", "package-lock.json", "tsconfig.json")}}
    require(bool(selected), "Chaincode source fingerprint is missing")
    return sha256(json.dumps(selected, sort_keys=True, separators=(",", ":")).encode())


def validate_manifest(manifest, sha, repository, origin):
    require(manifest.get("format") == 1 and manifest.get("sha") == sha, "Manifest commit mismatch")
    require(manifest.get("repository") == repository and manifest.get("origin") == origin, "Manifest deployment target mismatch")
    require(isinstance(manifest.get("files"), dict) and 3 <= len(manifest["files"]) <= 1000, "Invalid manifest file list")
    require(FIXED_FILES <= manifest["files"].keys(), "Missing deployment configuration")
    for name, digest in manifest["files"].items():
        require(allowed_file(name) and isinstance(digest, str) and bool(DIGEST.fullmatch(digest)), "Invalid release file")
    require(manifest.get("chaincode") == fingerprint(manifest["files"]), "Chaincode fingerprint mismatch")
    require("blockchain/chaincode/dist/index.js" in manifest["files"], "Compiled chaincode is missing")
    image(manifest.get("api"), repository, "api")
    image(manifest.get("web"), repository, "web")
    controller = manifest.get("controller", {})
    require(set(controller) == {"controller.py", "policy.py", "verify.mjs", "entry"} and
            all(isinstance(value, str) and DIGEST.fullmatch(value) for value in controller.values()), "Controller version metadata is missing")
    expected = {k.split("/")[-2]: v for k, v in manifest["files"].items() if k.endswith("/migration.sql")}
    require(manifest.get("migrations") == expected and bool(expected), "Migration catalog mismatch")
    return manifest


def extract(archive, destination, sha, repository, origin):
    """Extract only validated regular files; never tarfile.extractall."""
    destination = Path(destination)
    require(not destination.exists(), "Release directory already exists")
    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        require(len(members) <= 1100 and sum(m.size for m in members) <= 64 * 1024 * 1024, "Release archive is too large")
        names = set()
        for member in members:
            name = member.name
            require(member.isfile() and member.size <= 4 * 1024 * 1024, "Only bounded regular files are allowed")
            require(name not in names and "\\" not in name and not name.startswith("/") and
                    str(PurePosixPath(name)) == name and ".." not in PurePosixPath(name).parts, "Unsafe or duplicate archive path")
            require(name == "cd-manifest.json" or allowed_file(name), "Unexpected release path")
            names.add(name)
        require("cd-manifest.json" in names, "Release manifest is missing")
        raw = tar.extractfile("cd-manifest.json").read()
        manifest = validate_manifest(json.loads(raw), sha, repository, origin)
        require(names == set(manifest["files"]) | {"cd-manifest.json"}, "Archive differs from manifest")
        # Validate everything before creating a release directory.
        contents = {}
        for member in members:
            data = tar.extractfile(member).read()
            if member.name != "cd-manifest.json":
                require(sha256(data) == manifest["files"][member.name], "Release file checksum mismatch")
            contents[member.name] = data
        destination.mkdir(mode=0o755, parents=True)
        destination.chmod(0o755)
        for name, data in contents.items():
            target = destination / name
            target.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o644)
        for directory in destination.rglob("*"):
            if directory.is_dir():
                directory.chmod(0o755)
    return manifest


def read_env(filename):
    result = {}
    for line in Path(filename).read_text().splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition("=")
        require(bool(sep) and bool(re.fullmatch(r"[A-Z][A-Z0-9_]*", key)) and key not in result,
                "Invalid private environment format")
        require(not any(c in value for c in "\r\n\0") and not value.startswith(("'", '"')), "Unsupported environment value")
        result[key] = value
    return result


def statements(sql):
    # Tokenize quoted values/identifiers and comments before splitting statements.
    token = re.compile(r"--[^\n]*(?:\n|$)|/\*.*?\*/|'(?:''|[^'])*'|\"(?:\"\"|[^\"])*\"|[^'\"/-]+|[-/](?![-*])", re.S)
    parts = []
    position = 0
    for match in token.finditer(sql):
        require(match.start() == position, "Unsupported migration SQL syntax")
        value = match.group()
        parts.append(" " if value.startswith(("--", "/*")) else value)
        position = match.end()
    require(position == len(sql) and "$" not in "".join(parts), "Unsupported migration SQL syntax")
    clean = "".join(parts)
    split = re.split(r";(?=(?:[^']*'(?:''|[^'])*')*[^']*$)", clean)
    return [s.strip() for s in split if s.strip()]


def additive_sql(sql):
    for statement in statements(sql):
        normalized = re.sub(r"\s+", " ", statement).upper()
        if re.fullmatch(r"CREATE TABLE (?:\"[^\"]+\"|[A-Z_][A-Z0-9_]*) \(.+\)", normalized):
            # CREATE TABLE AS/LIKE is deliberately not permitted.
            require(not re.search(r"\b(DROP|ALTER|TRUNCATE|DELETE|UPDATE|INSERT|SELECT|LIKE)\b", normalized), "Unsupported new table migration")
        elif re.fullmatch(r"CREATE INDEX (?:\"[^\"]+\"|[A-Z_][A-Z0-9_]*) ON .+", normalized):
            require(not re.search(r"\b(WHERE|CONCURRENTLY|SELECT|FUNCTION)\b", normalized), "Unsupported index migration")
        elif re.fullmatch(r"ALTER TABLE (?:\"[^\"]+\"|[A-Z_][A-Z0-9_]*) ADD COLUMN .+", normalized):
            require(not re.search(r"\b(NOT NULL|DEFAULT|REFERENCES|CHECK|UNIQUE|PRIMARY|GENERATED|COLLATE)\b", normalized), "Auto-CD only adds nullable columns without defaults/constraints")
            require(bool(re.fullmatch(r'ALTER TABLE (?:"[^"]+"|[A-Z_][A-Z0-9_]*) ADD COLUMN (?:"[^"]+"|[A-Z_][A-Z0-9_]*) [A-Z_][A-Z0-9_]*(?:\([0-9, ]+\))?(?:\[\])?', normalized)), "Unsupported column migration")
        else:
            raise PolicyError("Migration requires separate compatibility review; automatic rollout blocked")
    require(bool(statements(sql)), "Empty migration is not allowed")


def migrations(applied, candidate, directory, compatible_missing=()):
    for name, digest in applied.items():
        if name not in candidate:
            require(name in compatible_missing, "Applied migration is absent from release")
        else:
            if candidate[name] != digest:
                # Prisma accepts platform line-ending variants of the same
                # script. Keep the recorded DB checksum untouched; validate
                # both manifest bytes and the narrowly equivalent variants.
                source = Path(directory) / "apps/api/prisma/migrations" / name / "migration.sql"
                require(source.is_file(), "Migration source file is missing")
                script = source.read_bytes()
                require(sha256(script) == candidate[name], "Migration source checksum mismatch")
                lf = script.replace(b"\r\n", b"\n")
                require(digest in {sha256(script), sha256(lf), sha256(lf.replace(b"\n", b"\r\n"))},
                        "Applied migration checksum was modified")
    new = sorted(set(candidate) - set(applied))
    for name in new:
        require(not applied or name > max(applied), "New migrations must append to history")
        sql = (Path(directory) / "apps/api/prisma/migrations" / name / "migration.sql").read_text()
        require(sha256(sql.encode()) == candidate[name], "Migration source checksum mismatch")
        additive_sql(sql)
    return new
