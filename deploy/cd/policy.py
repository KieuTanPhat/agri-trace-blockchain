"""Fail-closed release policies. No Docker or network side effects."""
import hashlib
import importlib.util
import ipaddress
import json
import re
import tarfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

_spec = importlib.util.spec_from_file_location("cd_targets", Path(__file__).with_name("targets.py"))
targets = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(targets)

SHA = re.compile(r"^[a-f0-9]{40}$")
DIGEST = re.compile(r"^[a-f0-9]{64}$")
OPERATIONS = {"deploy", "upgrade", "forward", "rollback", "recover", "status", "backup"}
FIXED_FILES = {"docker-compose.uat.yml", "docker-compose.uat-https.yml", "docker-compose.uat-fabric.yml", "deploy/Caddyfile.uat"}
MAX_AUTH_HEADER = 16 * 1024
CONTROLLER_FILES = ("controller.py", "policy.py", "targets.py", "verify.mjs", "verify-hosted.mjs", "session-auth.mjs", "entry")


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


def ci_gate(runs, sha, branch_sha, branch="main"):
    require(branch == "main", "Only main is deployable")
    require(sha == branch_sha, "Candidate is no longer latest branch HEAD")
    for filename in ("application-ci.yml", "blockchain-ci.yml", "dependency-audit.yml"):
        selected = sorted((run for run in runs if run.get("head_sha") == sha and run.get("head_branch") == branch and
                           run.get("event") == "push" and run.get("path") == f".github/workflows/{filename}"), key=lambda run: run["id"], reverse=True)
        require(bool(selected) and selected[0].get("status") == "completed" and selected[0].get("conclusion") == "success",
                "Server requires three successful exact-branch-push CI runs")


def command(value):
    # Deliberately no shell parsing/evaluation or user-supplied option flags.
    parts = value.split(" ")
    require(all(parts) and parts[0] in OPERATIONS, "Unsupported CD command")
    op = parts[0]
    expected = {"status": 1, "recover": 1, "rollback": 2, "backup": 2, "deploy": 3, "forward": 3, "upgrade": 4}[op]
    require(len(parts) == expected, "Invalid CD command arguments")
    if expected > 1:
        require(bool(SHA.fullmatch(parts[1])), "Invalid commit SHA")
    if op in {"deploy", "upgrade", "forward"}:
        require(bool(DIGEST.fullmatch(parts[2])), "Invalid archive checksum")
    if op == "upgrade":
        require(bool(re.fullmatch(r"[1-9][0-9]{0,8}", parts[3])), "Invalid expected sequence")
    return parts


def image(value, repository, component):
    prefix = f"ghcr.io/{repository.lower()}/{component}@sha256:"
    require(isinstance(value, str) and value.startswith(prefix) and bool(DIGEST.fullmatch(value[len(prefix):])),
            "Expected an immutable image digest from this repository")


def valid_public_origin(value):
    try:
        if value.endswith("/"):
            return False
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            return False
        if parsed.scheme == "http":
            return ipaddress.ip_address(host).version == 4
        if parsed.scheme == "https":
            try:
                ipaddress.ip_address(host)
                return False
            except ValueError:
                labels = host.split(".")
                return not parsed.port and len(labels) >= 2 and all(
                    re.fullmatch(r"[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?", label)
                    for label in labels)
        return False
    except (ValueError, TypeError):
        return False


def https_origins(origin):
    require(valid_public_origin(origin), "Invalid public deployment origin")
    if not origin.startswith("https://"):
        return []
    hostname = urlsplit(origin).hostname.removeprefix("www.")
    return [f"https://{hostname}", f"https://www.{hostname}"]


def allowed_file(name):
    if name in FIXED_FILES | targets.APP_FILES | targets.OPTIONAL_APP_FILES:
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


def validate_manifest(manifest, sha, repository, origin, target=None):
    require(manifest.get("format") == (2 if target else 1) and manifest.get("sha") == sha, "Manifest commit/format mismatch")
    require(manifest.get("repository") == repository and manifest.get("origin") == origin, "Manifest deployment target mismatch")
    require(valid_public_origin(origin), "Invalid public deployment origin")
    require(isinstance(manifest.get("files"), dict) and 3 <= len(manifest["files"]) <= 1000, "Invalid manifest file list")
    if target:
        targets.validate_target(target, require)
        for name in ("environment", "branch", "project", "profile"):
            require(manifest.get(name) == target[name], "Manifest environment binding mismatch")
        required = targets.APP_FILES
        require(not FIXED_FILES.intersection(manifest["files"]), "Legacy proxy configuration is not an app delivery")
    else:
        required = FIXED_FILES
    require(required <= manifest["files"].keys(), "Missing deployment configuration")
    for name, digest in manifest["files"].items():
        require(allowed_file(name) and isinstance(digest, str) and bool(DIGEST.fullmatch(digest)), "Invalid release file")
    require(manifest.get("chaincode") == fingerprint(manifest["files"]), "Chaincode fingerprint mismatch")
    require("blockchain/chaincode/dist/index.js" in manifest["files"], "Compiled chaincode is missing")
    image(manifest.get("api"), repository, "api")
    image(manifest.get("web"), repository, "web")
    if "chaincodeImage" in manifest:
        image(manifest["chaincodeImage"], repository, "chaincode")
    controller = manifest.get("controller", {})
    require(set(controller) == set(CONTROLLER_FILES) and
            all(isinstance(value, str) and DIGEST.fullmatch(value) for value in controller.values()), "Controller version metadata is missing")
    expected = {k.split("/")[-2]: v for k, v in manifest["files"].items() if k.endswith("/migration.sql")}
    require(manifest.get("migrations") == expected and bool(expected), "Migration catalog mismatch")
    return manifest


def extract(archive, destination, sha, repository, origin, target=None):
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
        manifest = validate_manifest(json.loads(raw), sha, repository, origin, target)
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


HYBRID_MIGRATION = re.compile(r"^[0-9]+_hybrid_")


def reviewed_migrations(value):
    """Only installed root-owned configuration may admit non-additive SQL.

    Release bundles cannot supply or widen this catalog. Admission is an exact
    byte checksum, with a mandatory protocol floor; it is never a parser bypass
    for an arbitrary migration name or a declaration of rollback compatibility.
    """
    require(isinstance(value, dict), "Invalid reviewed migration catalog")
    for name, review in value.items():
        require(isinstance(name, str) and bool(re.fullmatch(r"[a-zA-Z0-9_-]+", name)), "Invalid reviewed migration name")
        require(isinstance(review, dict) and set(review) == {"checksum", "protocol"} and
                isinstance(review.get("checksum"), str) and bool(DIGEST.fullmatch(review["checksum"])) and
                review.get("protocol") == "hybrid-abc/1", "Migration review requires an exact checksum and Hybrid protocol floor")
    return value


def application_floor(candidate, floor):
    require(isinstance(floor, dict), "Invalid Hybrid migration floor")
    require(all(candidate.get(name) == digest for name, digest in floor.items()),
            "Application crosses the protected Hybrid migration floor; use a compatible image or approved fix-forward")


def capacity_budget(host_bytes, limits, reserve_percent=20):
    require(type(host_bytes) is int and host_bytes > 0 and type(reserve_percent) is int and 20 <= reserve_percent < 100,
            "Capacity must reserve at least 20 percent of host memory")
    require(isinstance(limits, dict) and bool(limits) and all(type(value) is int and value > 0 for value in limits.values()),
            "Every running/proposed container must have a positive memory quota")
    total = sum(limits.values())
    require(total * 100 <= host_bytes * (100 - reserve_percent), "Combined legacy/hosted memory quota exceeds reserved host capacity")
    return {"hostBytes": host_bytes, "containerBytes": total, "reservedBytes": host_bytes - total, "minimumReservePercent": reserve_percent}


def migrations(applied, candidate, directory, compatible_missing=(), reviewed=None, floor=None):
    reviews = reviewed_migrations(reviewed or {})
    protected = dict(floor or {})
    for name, digest in applied.items():
        if HYBRID_MIGRATION.match(name) or name in reviews:
            protected[name] = digest
    application_floor(candidate, protected)
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
        script = (Path(directory) / "apps/api/prisma/migrations" / name / "migration.sql").read_bytes()
        require(sha256(script) == candidate[name], "Migration source checksum mismatch")
        review = reviews.get(name)
        if review is not None:
            require(candidate[name] == review["checksum"], "New migration differs from its reviewed checksum")
        else:
            require(not HYBRID_MIGRATION.match(name), "Hybrid migration requires an installed checksum review")
            additive_sql(script.decode("utf-8"))
    return new
