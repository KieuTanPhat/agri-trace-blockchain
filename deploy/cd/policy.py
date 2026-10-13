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
OPERATIONS = {"deploy", "upgrade", "rollback", "recover", "status", "backup"}
FIXED_FILES = {"docker-compose.uat.yml", "docker-compose.uat-https.yml", "docker-compose.uat-fabric.yml", "deploy/Caddyfile.uat"}
MAX_AUTH_HEADER = 16 * 1024
CONTROLLER_FILES = ("controller.py", "policy.py", "targets.py", "verify.mjs", "session-auth.mjs", "entry")
# Exact, separately reviewed expansion migrations. The parser for arbitrary SQL
# remains restrictive. See docs/hybrid-chain-management-implementation.md for
# compatibility boundaries and rollback verification of this particular script.
REVIEWED_EXPANSIONS = {
    "20261011140000_chain_management_foundation": "9beb5342bb4dbb7eae9f221d6fe1b6dbfd648bae7ba46cb3e580a6e69e26ac28",
}
# These guards change the application's authorization/route contract. A generic
# additive compatibility receipt cannot make a legacy image understand it.
REQUIRED_RELEASE_MIGRATIONS = frozenset({
    "20261013010000_hybrid_business_scope",
    "20261013011000_immutable_ledger_routes",
})


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
    if name in FIXED_FILES | targets.APP_FILES:
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


LEGACY_PINS_TARGET = "/run/agritrace/legacy-scope-pins.json"


def hybrid_environment(manifest, sha, services, environment, base):
    """Check deployment-owned metadata before any migration or writer stop."""
    present = REQUIRED_RELEASE_MIGRATIONS.intersection(manifest.get("migrations", {}))
    if not present:
        return False
    require(present == REQUIRED_RELEASE_MIGRATIONS and manifest.get("format") == 2,
            "Hybrid release requires the complete scope/ledger schema floor")

    def array(key, limit, byte_limit=20000):
        raw = environment.get(key, "[]")
        require(isinstance(raw, str) and len(raw) <= byte_limit, "Invalid Hybrid pin metadata")
        try:
            value = json.loads(raw)
        except (ValueError, TypeError):
            raise PolicyError("Invalid Hybrid pin metadata") from None
        require(isinstance(value, list) and len(value) <= limit, "Invalid Hybrid pin metadata")
        return value

    routes = array("LEDGER_ROUTE_PINS", 256)
    require(bool(routes) and all(isinstance(pin, str) and DIGEST.fullmatch(pin) for pin in routes) and
            len(set(routes)) == len(routes), "Missing or invalid route pins")
    require(environment.get("LEDGER_ACTIVE_ROUTE_DIGEST") in routes, "Active route is not independently pinned")
    imports = array("LEDGER_ROUTE_IMPORT_PINS", 256, 65536)
    require(all(isinstance(pin, dict) and set(pin) == {"digest", "environment", "sourceSha"} and
                isinstance(pin["digest"], str) and DIGEST.fullmatch(pin["digest"]) and
                pin["environment"] == "production" and isinstance(pin["sourceSha"], str) and
                SHA.fullmatch(pin["sourceSha"]) for pin in imports), "Invalid production route import pins")
    require(len({pin["digest"] for pin in imports}) == len(imports), "Duplicate route import pins")
    writers = array("LEDGER_PAUSED_WRITER_PINS", 256)
    require(all(isinstance(pin, str) and DIGEST.fullmatch(pin) for pin in writers) and
            len(set(writers)) == len(writers), "Invalid paused writer pins")
    authority = environment.get("LEDGER_WRITER_AUTHORITY", "")
    require(isinstance(authority, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}", authority),
            "Missing logical Worker authority")
    filename = environment.get("HYBRID_LEGACY_MANIFEST_PINS_HOST", "")
    require(isinstance(filename, str) and targets.owned_path(filename, Path(base) / "shared" / "hybrid"),
            "Legacy pins file must belong to the production metadata directory")
    path = Path(filename)
    require(not path.is_symlink() and path.is_file() and path.stat().st_size <= 8 * 1024 * 1024 and
            path.resolve().is_relative_to((Path(base) / "shared" / "hybrid").resolve()),
            "Legacy pins must be a bounded regular metadata file")
    require(not (path.stat().st_mode & 0o022), "Legacy pins metadata is writable by another account")
    require(path.stat().st_mode & 0o777 in (0o444, 0o644),
            "Nonsecret legacy pin metadata must be readable by both nonroot services (0444/0644)")
    try:
        legacy = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, OSError):
        raise PolicyError("Invalid legacy pins metadata") from None
    require(isinstance(legacy, dict) and legacy.get("schema") == "agritrace-legacy-scope-pins-1" and
            isinstance(legacy.get("pins"), list) and len(legacy["pins"]) <= 100 and
            all(isinstance(pin, dict) and isinstance(pin.get("manifest"), dict) and
                pin["manifest"].get("environment") == "production" for pin in legacy["pins"]),
            "Invalid production legacy pins metadata")
    for name in ("api", "worker"):
        service = services.get(name, {})
        values = service.get("environment", {})
        require(values.get("NODE_ENV") == "production", "Hybrid application services must use production metadata authority")
        require(values.get("APP_RELEASE_SHA") == sha and bool(SHA.fullmatch(sha)), "Runtime release SHA differs from candidate")
        for key in ("LEDGER_ROUTE_PINS", "LEDGER_ACTIVE_ROUTE_DIGEST", "LEDGER_ROUTE_IMPORT_PINS", "LEDGER_PAUSED_WRITER_PINS"):
            expected = environment.get(key, "[]" if key.endswith("_PINS") else "")
            require(values.get(key) == expected, "Runtime trust pins differ from deployment-owned metadata")
        require(values.get("HYBRID_LEGACY_MANIFEST_PINS_FILE") == LEGACY_PINS_TARGET and
                values.get("LEDGER_ROUTE_IMPORT_ENABLED", "false") == "false", "Operator import is enabled in an application service")
        mounts = service.get("volumes", [])
        pins = [mount for mount in mounts if mount.get("target") == LEGACY_PINS_TARGET]
        require(len(pins) == 1 and pins[0].get("type") == "bind" and pins[0].get("source") == filename and
                pins[0].get("read_only") and not pins[0].get("bind", {}).get("create_host_path"),
                "Runtime legacy pins mount is not the reviewed read-only file")
        if name == "api":
            require(len(mounts) == 1 and values.get("FABRIC_ENABLED") == "false" and
                    not any(key.startswith("FABRIC_IDENTITY_") or key == "RELAYER_MSP_DIR" for key in values),
                    "API received signing material")
        else:
            require(values.get("LEDGER_WRITER_AUTHORITY") == authority, "Worker logical authority differs from deployment metadata")
            route = {"protocol": "agritrace-ledger-route/1", "mode": "WRITE", "envelopeVersion": "3.0.0",
                     "writerAuthority": authority, "writerRole": "relayer"}
            for field, key in (("network", "FABRIC_NETWORK_NAME"), ("channelId", "FABRIC_CHANNEL_NAME"),
                               ("chaincodeName", "FABRIC_CHAINCODE_NAME"), ("contractName", "FABRIC_CONTRACT_NAME"),
                               ("writerMspId", "FABRIC_MSP_ID")):
                value = values.get(key)
                require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,99}", value),
                        "Missing explicit Worker route binding")
                route[field] = value
            # This fixed protocol contains only ASCII keys/string values, so
            # sorted compact JSON has the same bytes as its RFC8785 payload.
            digest = sha256(json.dumps(route, sort_keys=True, separators=(",", ":")).encode())
            require(digest == environment["LEDGER_ACTIVE_ROUTE_DIGEST"],
                    "Active route digest differs from the logical Worker binding")
    return True


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
            require(name not in REQUIRED_RELEASE_MIGRATIONS,
                    "Release is below the required scope/ledger schema floor")
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
        if name in REVIEWED_EXPANSIONS:
            require(sha256(script.replace(b"\r\n", b"\n")) == REVIEWED_EXPANSIONS[name],
                    "Reviewed expansion migration was modified")
        else:
            additive_sql(script.decode("utf-8"))
    return new
