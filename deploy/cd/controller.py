#!/usr/bin/env python3
"""Transactional delivery. This installed file is root-owned, not run from a release."""
import argparse
import contextlib
import datetime
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

# -I excludes both PYTHONPATH and the script directory; load the trusted sibling.
spec = importlib.util.spec_from_file_location("cd_policy", Path(__file__).with_name("policy.py"))
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)
PolicyError, require = policy.PolicyError, policy.require
FABRIC = ["ca_org1", "ca_org2", "ca_orderer", "orderer.example.com", "peer0.org1.example.com", "peer0.org2.example.com"]
LEDGERS = ["compose_orderer.example.com", "compose_peer0.org1.example.com", "compose_peer0.org2.example.com"]


def sync_directory(directory):
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def atomic_json(filename, data):
    filename = Path(filename)
    filename.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temporary = filename.with_suffix(".tmp")
    with temporary.open("w") as file:
        os.chmod(temporary, 0o600)
        json.dump(data, file, indent=2, sort_keys=True)
        file.write("\n")
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, filename)
    sync_directory(filename.parent)


class Controller:
    def __init__(self, config):
        self.config = config
        require(config.get("schema") in (None, 2) and ("environment" not in config or config.get("schema") == 2), "Unsupported installed config schema")
        self.target = policy.targets.validate_config(config, require) if config.get("schema") == 2 else None
        self.fabric_active = True  # Production and retained UAT releases require Fabric.
        self.project = config["project"] if self.target else "agri-trace-uat"
        self.prefix = policy.targets.TARGETS[config["environment"]]["prefix"] if self.target else "uat"
        self.fabric = config.get("fabric") or {}
        self.base = Path(config["base"])
        self.storage = self.base / "cd"
        self.environment = policy.read_env(config["env"])
        self.log = self.storage / "operations.log"
        self.phase = "initial"

    def run(self, label, args, data=None, timeout=240, env=None, output=None):
        # Resolved Compose and credentials never reach stdout or diagnostic logs.
        self.phase = label
        result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, env=env)
        with self.log.open("ab") as log:
            os.chmod(self.log, 0o600)
            log.write(f"{datetime.datetime.now(datetime.timezone.utc).isoformat()} {label} exit={result.returncode}\n".encode())
            if result.returncode:
                log.write(result.stderr[:128 * 1024])
        require(result.returncode == 0, f"CD operation failed at {label}; private diagnostics are on VPS")
        return result.stdout

    def state(self):
        return json.loads((self.storage / "state.json").read_text())

    def record(self, release):
        prefixes = {self.prefix + "-"}
        if self.target and self.config["environment"] == "production":
            prefixes.add("uat-")
        require(any(release.startswith(prefix) for prefix in prefixes) and all(c.isalnum() or c in "-_." for c in release), "Unknown release")
        return json.loads((self.storage / "records" / release / "record.json").read_text())

    def save_record(self, record):
        if self.target:
            record["runtimeProfile"] = "fabric"
        directory = self.storage / "records" / record["id"]
        atomic_json(directory / "record.json", record)
        atomic_json(directory / "images.json", {"services": {
            name: {"image": record["manifest"]["web" if name == "web" else "api"]}
            for name in (("api", "worker", "migrate", "web") if self.target and record["manifest"].get("format") == 2
                         else ("api", "worker", "migrate", "bootstrap", "web"))}})
        self.write_release_environment(record)

    def origin_for(self, record):
        return (record.get("manifest", {}).get("origin") or self.config.get("legacy_origin") or
                self.config.get("origin") or self.environment["PUBLIC_ORIGIN"])

    def write_release_environment(self, record):
        origin = self.origin_for(record)
        cors_origins = (self.environment.get("CORS_ORIGINS", origin).split(",")
                        if origin.startswith("https://") else [origin])
        values = {"PUBLIC_ORIGIN": origin, "CORS_ORIGINS": ",".join(cors_origins)}
        if self.target and record["manifest"].get("format") == 2:
            values.update(DEPLOY_ENV=self.config["environment"], INGRESS_NETWORK=self.config["ingress"],
                          API_IMAGE=record["manifest"]["api"], WEB_IMAGE=record["manifest"]["web"],
                          POSTGRES_VOLUME=self.config["postgres_volume"], UPSTREAM_PREFIX=self.prefix,
                          POSTGRES_MEMORY="1g",
                          API_MEMORY="768m",
                          API_HEAP_MB="512",
                          WEB_MEMORY="768m",
                          WEB_HEAP_MB="512")
            values["FABRIC_DOCKER_NETWORK"] = self.fabric["network"]
            if policy.REQUIRED_RELEASE_MIGRATIONS.intersection(record["manifest"].get("migrations", {})):
                values["APP_RELEASE_SHA"] = record["sha"]
        directory = self.storage / "records" / record["id"]
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        filename = directory / "origin.env"
        temporary = filename.with_suffix(".tmp")
        with temporary.open("w") as output:
            os.chmod(temporary, 0o600)
            for key, value in values.items():
                require(not any(char in value for char in "\r\n\0"), "Invalid release origin environment")
                output.write(f"{key}={value}\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, filename)

    def dc(self, record, *args):
        root = Path(record["directory"])
        self.write_release_environment(record)
        if self.target and record["manifest"].get("format") == 2:
            compose_files = ["-f", str(root / "docker-compose.app.yml")]
            compose_files += ["-f", str(root / "docker-compose.app-fabric.yml")]
            compose_files += ["-f", str(self.storage / "records" / record["id"] / "images.json")]
            if self.fabric:
                # API verifies cached receipts without a signing identity. Its
                # read context must match the retained
                # ledger, including releases predating explicit binding metadata.
                context = self.storage / "records" / record["id"] / "ledger-context.json"
                atomic_json(context, {"services": {"api": {"environment": {"FABRIC_CHANNEL_NAME": self.fabric["channel"]}}}})
                compose_files += ["-f", str(context)]
            return ["docker", "compose", "--project-name", self.project, "--env-file", self.config["env"],
                    "--env-file", str(self.storage / "records" / record["id"] / "origin.env"), *compose_files,
                    "--profile", "fabric", *args]
        compose_files = ["-f", str(root / "docker-compose.uat.yml")]
        if self.origin_for(record).startswith("https://"):
            compose_files += ["-f", str(root / "docker-compose.uat-https.yml")]
        compose_files += ["-f", str(root / "docker-compose.uat-fabric.yml"),
                          "-f", str(self.storage / "records" / record["id"] / "images.json")]
        if self.target and self.config.get("edge_adopted"):
            overlay = self.storage / "records" / record["id"] / "ingress.json"
            atomic_json(overlay, {"services": {name: {"networks": {"default": {}, "ingress": {"aliases": [self.prefix + "-" + name]}}}
                                               for name in ("api", "web")},
                                 "networks": {"ingress": {"external": True, "name": self.config["ingress"]}}})
            compose_files += ["-f", str(overlay)]
        return ["docker", "compose", "--project-name", self.project, "--env-file", self.config["env"],
                "--env-file", str(self.storage / "records" / record["id"] / "origin.env"), *compose_files, *args]

    def preflight(self, record):
        require(shutil.disk_usage(self.base).free >= 12 * 1024 ** 3, "At least 12 GiB free disk is required")
        for name, digest in record["manifest"].get("controller", {}).items():
            require(policy.sha256(Path(__file__).with_name(name).read_bytes()) == digest,
                    "CD controller changed; administrator must install the reviewed version before delivery")
        model = json.loads(self.run("compose-preflight", self.dc(record, "--profile", "tools", "config", "--format", "json")))
        if self.target and record["manifest"].get("format") == 2:
            self.target_preflight(record, model)
            return
        require(model["name"] == "agri-trace-uat", "Compose project changed")
        services = model["services"]
        release_origin = self.origin_for(record)
        require(set(services) == {"postgres", "migrate", "bootstrap", "api", "worker", "web", "proxy"}, "Unexpected Compose services")
        for name, service in services.items():
            require(len(service.get("ports", [])) == (2 if name == "proxy" and release_origin.startswith("https://") else
                    1 if name == "proxy" else 0), "Unexpected published service port")
            require(not service.get("privileged") and not service.get("cap_add") and not service.get("devices") and
                    not service.get("network_mode") and not service.get("pid"), "Unexpected container privilege")
        require(services["postgres"]["image"] == self.environment["POSTGRES_IMAGE"] and
                services["proxy"]["image"] == self.environment["CADDY_IMAGE"], "Infrastructure image changes require separate review")
        require(services["postgres"]["volumes"][0]["source"] == "postgres-data" and
                services["postgres"]["volumes"][0]["target"] == "/var/lib/postgresql", "Database volume changed")
        release_environment = self.storage / "records" / record["id"] / "origin.env"
        release_values = policy.read_env(release_environment)
        if release_origin.startswith("https://"):
            require(self.environment["PUBLIC_ORIGIN"] == release_origin and
                    release_origin in self.environment.get("CORS_ORIGINS", "").split(","),
                    "Administrator must update the installed origin before domain delivery")
        expected_ports = {("80", "tcp"): (self.environment["HTTP_PORT"], self.environment["HTTP_BIND"])}
        if release_origin.startswith("https://"):
            expected_ports[("443", "tcp")] = (self.environment["HTTPS_PORT"], self.environment["HTTPS_BIND"])
        actual_ports = {}
        for port in services["proxy"]["ports"]:
            key = (str(port["target"]), port.get("protocol", "tcp"))
            require(key not in actual_ports, "Duplicate public port")
            actual_ports[key] = (str(port["published"]), port["host_ip"])
        expected_ports = {key: (str(value[0]), value[1]) for key, value in expected_ports.items()}
        require(actual_ports == expected_ports, "Public binding changed")
        require(services["proxy"].get("environment", {}).get("CADDY_SITE_ADDRESS") == self.environment["CADDY_SITE_ADDRESS"],
                "Caddy site address changed")
        require(release_values["PUBLIC_ORIGIN"] == release_origin, "Release public origin overlay is invalid")
        expected_database = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@postgres:5432/{self.environment['POSTGRES_DB']}?schema=public"
        for name in ("api", "worker", "migrate", "bootstrap"):
            require(services[name]["environment"]["DATABASE_URL"] == expected_database, "Database configuration changed")
        for name in ("api", "web"):
            require(not services[name].get("volumes") and not services[name].get("secrets"), "Public service received host secrets")
        if record["manifest"].get("controller"):
            require(services["web"]["environment"].get("API_INTERNAL_BASE_URL") == "http://api:8080/api",
                    "Web server must use the internal API for public trace rendering")
            build_args = services["web"].get("build", {}).get("args", {})
            require(build_args.get("NEXT_PUBLIC_API_BASE_URL") == f"{release_origin}/api" and
                    build_args.get("NEXT_PUBLIC_TRACE_BASE_URL") == f"{release_origin}/trace" and
                    build_args.get("NEXT_PUBLIC_MOCK_API") == "false",
                    "Web build public URLs do not match the release origin")
        cors_origins = release_values["CORS_ORIGINS"].split(",")
        require(services["api"]["environment"]["FABRIC_ENABLED"] == "false" and
                services["api"]["environment"]["CORS_ORIGIN"] == release_values["CORS_ORIGINS"] and
                release_origin in cors_origins and
                services["api"]["environment"]["JWT_SECRET"] == self.environment["JWT_SECRET"], "API environment changed")
        worker = services["worker"]
        require(worker["environment"]["FABRIC_ENABLED"] == "true" and worker["user"] == f"{self.environment['WORKER_UID']}:{self.environment['WORKER_GID']}", "Worker signing boundary changed")
        mounts = {mount["target"]: mount for mount in worker.get("volumes", [])}
        require(set(mounts) == {"/fabric-identity", "/fabric-tls/ca.crt"}, "Worker mount set changed")
        for target, key in (("/fabric-identity", "RELAYER_MSP_DIR_HOST"), ("/fabric-tls/ca.crt", "FABRIC_TLS_CERT_HOST")):
            mount = mounts[target]
            require(mount["source"] == self.environment[key] and mount.get("read_only") and
                    not mount.get("bind", {}).get("create_host_path"), "Worker signing mount changed")
        require(model["networks"]["fabric"]["external"] and model["networks"]["fabric"]["name"] == "fabric_test", "Fabric network changed")

    def target_preflight(self, record, model):
        policy.validate_manifest(record["manifest"], record["sha"], self.config["repository"], self.config["origin"], self.target)
        require(model["name"] == self.project, "Compose project changed")
        services = model["services"]
        hybrid = policy.hybrid_environment(record["manifest"], record["sha"], services, self.environment, self.base)
        require({"postgres", "migrate", "api", "web"} <= set(services) <= {"postgres", "migrate", "api", "worker", "web"}, "Unexpected app services")
        require(model["volumes"]["postgres-data"]["name"] == self.config["postgres_volume"], "Database volume changed")
        require(model["networks"]["default"]["name"] == self.project + "_default" and
                model["networks"]["ingress"]["external"] and model["networks"]["ingress"]["name"] == self.config["ingress"], "App network changed")
        allowed_networks = {"default", "ingress", "fabric"}
        require(set(model["networks"]) == allowed_networks, "Unexpected app network")
        expected_database = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@postgres:5432/{self.environment['POSTGRES_DB']}?schema=public"
        for name, service in services.items():
            require(not any(service.get(k) for k in ("ports", "privileged", "cap_add", "devices", "network_mode", "pid", "extra_hosts", "secrets")), "Unexpected container privilege/port/secret")
            require(set(service.get("networks", {})) == ({"default", "ingress"} if name in {"api", "web"} else
                    {"default", "fabric"} if name == "worker" else {"default"}), "Unexpected service network")
            if name != "web":
                require(service["environment"].get("DATABASE_URL", expected_database) == expected_database, "Database configuration changed")
            if name in {"migrate", "web"} or (name == "api" and not hybrid):
                require(not service.get("volumes"), "Public/tool service received host mounts")
        require(services["postgres"]["image"] == self.environment["POSTGRES_IMAGE"], "Database image changed")
        mounts = services["postgres"].get("volumes", [])
        require(len(mounts) == 1 and mounts[0].get("type") == "volume" and mounts[0]["source"] == "postgres-data" and
                mounts[0]["target"] == "/var/lib/postgresql", "Database mount changed")
        origin = self.config["origin"]
        cors = self.environment["CORS_ORIGINS"].split(",")
        require(set(cors) == set(policy.https_origins(origin)) | set(self.config.get("legacy_cors_origins", [])), "Cross-environment CORS is forbidden")
        api = services["api"]["environment"]
        require(api["FABRIC_ENABLED"] == "false" and api["JWT_SECRET"] == self.environment["JWT_SECRET"] and
                api["CORS_ORIGIN"] == self.environment["CORS_ORIGINS"] and api["PUBLIC_TRACE_BASE_URL"] == origin + "/trace", "API environment changed")
        if self.fabric:
            require(api.get("FABRIC_CHANNEL_NAME") == self.fabric["channel"], "API receipt channel differs from its retained ledger")
        require(services["web"]["environment"].get("API_INTERNAL_BASE_URL") == "http://api:8080/api", "SSR API boundary changed")
        for name in ("api", "web"):
            require(services[name]["networks"]["ingress"].get("aliases", []) == [self.prefix + "-" + name], "Ingress alias changed")
        worker = services["worker"]
        require(model["networks"]["fabric"]["external"] and model["networks"]["fabric"]["name"] == self.fabric["network"], "Fabric network changed")
        require(worker["environment"]["FABRIC_ENABLED"] == "true" and worker["environment"]["FABRIC_CHANNEL_NAME"] == self.fabric["channel"] and
                worker["environment"]["FABRIC_CHAINCODE_NAME"] == self.fabric["chaincode"] and
                worker["user"] == f"{self.environment['WORKER_UID']}:{self.environment['WORKER_GID']}", "Worker signing boundary changed")
        mounts = {mount["target"]: mount for mount in worker.get("volumes", [])}
        expected_mounts = {"/fabric-identity", "/fabric-tls/ca.crt"}
        if hybrid:
            expected_mounts.add(policy.LEGACY_PINS_TARGET)
        require(set(mounts) == expected_mounts, "Worker mount set changed")
        for path, key in (("/fabric-identity", "RELAYER_MSP_DIR_HOST"), ("/fabric-tls/ca.crt", "FABRIC_TLS_CERT_HOST")):
            require(mounts[path]["source"] == self.environment[key] and mounts[path].get("read_only") and
                    not mounts[path].get("bind", {}).get("create_host_path"), "Worker signing mount changed")
        if hybrid:
            # Validate canonical manifest/plan bytes with the candidate's actual
            # runtime validator, without DB access or a signing mount. This is
            # still preflight: no writers have stopped and no SQL has run.
            result = json.loads(self.run("hybrid-metadata-validate", self.dc(record, "run", "--rm", "--no-deps", "--pull", "never",
                                "--entrypoint", "node", "api", "apps/api/scripts/check-hybrid-pins.mjs")))
            require(result.get("result") == "passed" and result.get("sourceSha") == record["sha"] and
                    result.get("databaseAccessed") is False and result.get("signingMaterialRead") is False,
                    "Candidate runtime rejected independent Hybrid metadata")

    def applied(self, record):
        query = 'SELECT migration_name,checksum,finished_at IS NOT NULL AS complete FROM "_prisma_migrations" WHERE rolled_back_at IS NULL ORDER BY migration_name'
        result = self.run("migration-catalog", self.dc(record, "exec", "-T", "postgres", "psql", "-U", self.environment["POSTGRES_USER"],
                         "-d", self.environment["POSTGRES_DB"], "-v", "ON_ERROR_STOP=1", "-At", "-F", "|", "-c", query)).decode()
        applied = {}
        for line in result.splitlines():
            name, digest, complete = line.split("|")
            require(complete == "t", "An unfinished database migration must be reconciled before CD")
            applied[name] = digest
        return applied

    def verify(self, record, canary=None):
        self.write_release_environment(record)
        values = policy.read_env(self.storage / "records" / record["id"] / "origin.env")
        payload = {"origin": self.origin_for(record), "corsOrigins": values["CORS_ORIGINS"].split(","),
                   "accounts": json.loads(Path(self.config["accounts"]).read_text()), "canary": canary,
                   "requireSessionFamily": bool(canary) or record.get("sessionContract") == "family-v1",
                   "legacyQrLotIds": record.get("legacyQrLotIds", [])}
        if self.target:
            payload.update(profile="fabric", canaryCatalog=self.config["canary"], environment=self.config["environment"])
        script = (Path(__file__).with_name("session-auth.mjs").read_text() + "\n" +
                  Path(__file__).with_name("verify.mjs").read_text())
        output = self.run("release-verification", self.dc(record, "exec", "-T", "worker", "node", "--input-type=module", "-e", script),
                          json.dumps(payload).encode(), timeout=480)
        result = json.loads(output)
        require(result.get("result") == "passed", "Release verification did not succeed")
        return result

    def quiescent_baseline(self, record, verified):
        tables = ("app_user", "organization", "farm", "plot", "product", "production_cycle", "harvest_event",
                  "lot", "shipment", "trace_event", "blockchain_outbox", "blockchain_proof")
        counts = ",".join(f"'{table}',(SELECT count(*) FROM {table})" for table in tables)
        query = ("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SELECT json_build_object('counts',json_build_object("
                 + counts + "),'events',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT e.event_id,"
                 "to_jsonb(e)::text AS event_row,CASE WHEN p.tx_id IS NOT NULL THEN "
                 "json_build_array(p.tx_id,p.data_hash,p.channel_id) END AS proof FROM trace_event e "
                 "LEFT JOIN blockchain_proof p USING(event_id) ORDER BY e.event_id) x)); COMMIT;")
        result = json.loads(self.run("quiescent-baseline", self.dc(record, "exec", "-T", "postgres", "psql",
                            "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"],
                            "-v", "ON_ERROR_STOP=1", "-Atq", "-c", query)))
        require(0 < len(result["events"]) <= 10000, "Quiescent event verification budget exceeded")
        fingerprints = {}
        for row in result["events"]:
            fingerprints["event:" + row["event_id"]] = policy.sha256(row["event_row"].encode())
            if row["proof"] is not None:
                fingerprints["proof:" + row["event_id"]] = policy.sha256(
                    json.dumps(row["proof"], ensure_ascii=False, separators=(",", ":")).encode())
        frozen = dict(verified, counts=result["counts"], fingerprints=fingerprints)
        self.preserve(verified, frozen)
        return frozen

    def hybrid_readiness(self, record):
        if not policy.REQUIRED_RELEASE_MIGRATIONS <= set(record["manifest"]["migrations"]):
            return
        result = json.loads(self.run("hybrid-route-readiness", self.dc(record, "--profile", "tools", "run",
                            "--rm", "--no-deps", "--pull", "never", "--entrypoint", "node", "api",
                            "apps/api/scripts/check-hybrid-readiness.mjs"), timeout=180))
        require(result.get("result") == "passed" and result.get("sourceSha") == record["sha"] and
                result.get("readOnly") is True and result.get("signingMaterialRead") is False,
                "Hybrid history/active-route registration is not ready; writers remain stopped")

    def metadata_digest(self):
        # Compose resolves this live file at each invocation. Checking only
        # the cached dictionary would miss an administrator's mid-cutover edit.
        require(policy.read_env(self.config["env"]) == self.environment,
                "Shared deployment environment changed during the cutover")
        return policy.hybrid_metadata_digest(self.environment, self.base)

    def clear_journal(self):
        filename = self.storage / "journal.json"
        saved = json.loads(filename.read_text())
        try:
            filename.unlink()
            sync_directory(self.storage)
        except Exception:
            # If the directory flush fails, recreate the recovery record rather
            # than treating an unconfirmed unlink as a durable completion.
            atomic_json(filename, saved)
            raise

    def prepare_compatible_start(self, record):
        if policy.REQUIRED_RELEASE_MIGRATIONS <= set(record["manifest"]["migrations"]):
            self.preflight(record)
            self.hybrid_readiness(record)

    @staticmethod
    def file_digest(filename):
        digest = hashlib.sha256()
        with Path(filename).open("rb") as file:
            for chunk in iter(lambda: file.read(1024 * 1024), b""):
                digest.update(chunk)
        return digest.hexdigest()

    def snapshot_reference(self, directory, source_sha):
        path = Path(directory)
        require(not path.is_symlink() and path.is_dir() and path.resolve().is_relative_to((self.base / "backups").resolve()),
                "Forward recovery snapshot must belong to this production workspace")
        index = json.loads((self.storage / "backups.json").read_text())
        require(index.get(source_sha) == str(path), "Completed cutover snapshot index is missing")
        for name in ("snapshot.cms", "checksums.json", "hybrid-metadata.json", "legacy-scope-pins.json"):
            source = path / name
            require(not source.is_symlink() and source.is_file(), "Cutover snapshot is incomplete")
        require((path / "snapshot.cms").stat().st_size > 512, "Encrypted cutover snapshot is incomplete")
        checksums = json.loads((path / "checksums.json").read_text())
        require({"baseline.json", "release.json", "postgres.dump", "private-config.tar.gz",
                 "legacy-scope-pins.json", "hybrid-metadata.json"} <= set(checksums), "Snapshot lacks independent authority")
        for name, digest in checksums.items():
            require(isinstance(name, str) and "/" not in name and "\\" not in name and name not in (".", "..") and
                    isinstance(digest, str) and bool(policy.DIGEST.fullmatch(digest)), "Invalid snapshot checksum catalog")
            source = path / name
            require(not source.is_symlink() and source.is_file() and self.file_digest(source) == digest,
                    "Cutover snapshot checksum differs")
        metadata = json.loads((path / "hybrid-metadata.json").read_text())
        require(metadata.get("attemptSha") == source_sha and metadata.get("sha256") == checksums["legacy-scope-pins.json"],
                "Cutover snapshot authority provenance differs")
        return {"sourceSha": source_sha, "directory": str(path), "encryptedSha256": self.file_digest(path / "snapshot.cms"),
                "checksumsSha256": self.file_digest(path / "checksums.json")}

    def start(self, record):
        self.run("api-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "api"), timeout=240)
        self.run("worker-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "worker"), timeout=240)
        edge_owned = self.target and (record["manifest"].get("format") == 2 or self.config.get("edge_adopted"))
        self.run("web-proxy-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "web", *([] if edge_owned else ["proxy"])), timeout=240)
        if self.origin_for(record).startswith("https://"):
            self.phase = "public-https-readiness"
            origins = policy.https_origins(self.origin_for(record))
            deadline = time.monotonic() + 180
            while time.monotonic() < deadline:
                try:
                    for origin in origins:
                        with urllib.request.urlopen(origin + "/login", timeout=5) as response:
                            require(response.status == 200, "Public HTTPS login route is not ready")
                    return
                except Exception:
                    time.sleep(5)
            require(False, "Public HTTPS routes did not become ready for apex and www")

    def stop(self, record):
        self.run("stop-writers", self.dc(record, "stop", "api", "worker"), timeout=200)

    @contextlib.contextmanager
    def stop_on_failure(self, record):
        # Readiness can fail after API/Worker have started. An unverified
        # recovery must not keep accepting writes while its journal is open.
        try:
            yield
        except Exception:
            failed_phase = self.phase
            try:
                self.stop(record)
            finally:
                self.phase = failed_phase
            raise

    def migrate(self, record):
        # compose run uses an already pulled image by default; --no-build is
        # an option of compose up, not run. Explicitly prohibit registry pulls.
        self.run("migration-deploy", self.dc(record, "--profile", "tools", "run", "--rm", "--no-deps", "--pull", "never", "migrate"), timeout=300)

    def registry(self, record, auth):
        policy.registry_auth(auth)
        with self.log.open("a") as log:
            log.write(f"{datetime.datetime.now(datetime.timezone.utc).isoformat()} registry-auth token-bytes={len(auth['token'])} username-valid=true\n")
        with tempfile.TemporaryDirectory(prefix="registry-", dir=self.storage) as directory:
            self.run("registry-login", ["docker", "--config", directory, "login", "ghcr.io", "-u", auth["username"], "--password-stdin"], auth["token"].encode())
            for component in ("api", "web"):
                image = record["manifest"][component]
                self.run("immutable-image-pull", ["docker", "--config", directory, "pull", image], timeout=600)
                metadata = json.loads(self.run("image-identity", ["docker", "inspect", image]))[0]["Config"]
                labels = metadata.get("Labels") or {}
                require(labels.get("org.opencontainers.image.revision") == record["sha"] and
                        labels.get("org.opencontainers.image.source") == f"https://github.com/{self.config['repository']}" and
                        labels.get("agritrace.public-origin") == self.config["origin"], "Image labels do not match the tested release")
                if self.target:
                    require(labels.get("agritrace.environment") == self.config["environment"] and
                            labels.get("agritrace.branch") == self.config["branch"] and labels.get("agritrace.format") == "2", "Image environment labels changed")
                require(metadata["User"] not in ("", "root", "0", "0:0"), "Application image must run without root")

    def server_gate(self, record, auth):
        def request(route):
            headers = {"Authorization": f"Bearer {auth['token']}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
            url = f"https://api.github.com/repos/{self.config['repository']}/{route}"
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=20) as response:
                    return json.load(response)
            except Exception:
                raise PolicyError("Server could not verify GitHub CI; deployment blocked")
        name = self.config["branch"] if self.target else "main"
        branch = request("git/ref/heads/" + name)
        runs = request(f"actions/runs?head_sha={record['sha']}&event=push&per_page=100")
        policy.ci_gate(runs["workflow_runs"], record["sha"], branch["object"]["sha"], name)

    def journal(self, old, candidate, stage, baseline=None):
        filename = self.storage / "journal.json"
        previous = json.loads(filename.read_text()) if filename.exists() else {}
        updated = dict(previous, previous=old["id"], candidate=candidate["id"], stage=stage)
        if baseline is not None:
            updated["baseline"] = baseline
        atomic_json(filename, updated)

    def snapshot(self, old, attempt_sha, baseline):
        if self.target:
            return self.target_snapshot(old, attempt_sha, baseline)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        directory = self.base / "backups" / f"cd-{attempt_sha}-{stamp}"
        directory.mkdir(mode=0o700)
        atomic_json(directory / "baseline.json", baseline)
        atomic_json(directory / "release.json", old)
        with (directory / "postgres.dump").open("wb") as output:
            os.chmod(output.name, 0o600)
            self.run("postgres-consistent-backup", self.dc(old, "exec", "-T", "postgres", "pg_dump", "--format=custom", "--no-owner", "--no-acl",
                     "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"]), output=output)
        try:
            self.run("fabric-stop-for-snapshot", ["docker", "stop", "--time", "20", *FABRIC], timeout=180)
            for volume in LEDGERS:
                mount = self.run("ledger-volume-path", ["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", volume]).decode().strip()
                require(mount == f"/var/lib/docker/volumes/{volume}/_data", "Unexpected ledger volume path")
            self.run("ledger-consistent-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "fabric-ledger.tar.gz"),
                     "-C", "/var/lib/docker/volumes", *[f"{volume}/_data" for volume in LEDGERS]])
            self.run("private-identity-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "identities-config.tar.gz"),
                     "-C", self.config["network_root"], "blockchain/.fabric/fabric-samples/test-network/organizations", "blockchain/network/identities", "blockchain/network/.env",
                     "-C", str(Path(self.config["env"]).parent), ".env.uat", "accounts.json"])
            files = ["postgres.dump", "fabric-ledger.tar.gz", "identities-config.tar.gz", "baseline.json", "release.json"]
            checksums = {name: policy.sha256((directory / name).read_bytes()) for name in files}
            atomic_json(directory / "checksums.json", checksums)
            plain = directory / "snapshot.tar"
            self.run("snapshot-bundle", ["tar", "-cf", str(plain), "-C", str(directory), *files, "checksums.json"])
            self.run("encrypted-offsite-backup", ["openssl", "cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER", "-in", str(plain),
                     "-out", str(directory / "snapshot.cms"), self.config["backup_certificate"]])
            plain.unlink()
            for file in directory.iterdir():
                file.chmod(0o600)
            index_file = self.storage / "backups.json"
            index = json.loads(index_file.read_text()) if index_file.exists() else {}
            index[attempt_sha] = str(directory)
            atomic_json(index_file, index)
        finally:
            # Persistent services only: peers recreate chaincode containers.
            phase = self.phase
            self.resume_fabric()
            self.phase = phase
        return str(directory)

    def target_snapshot(self, old, attempt_sha, baseline):
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        directory = self.base / "backups" / f"{self.prefix}-{attempt_sha}-{stamp}"
        directory.mkdir(mode=0o700)
        atomic_json(directory / "baseline.json", baseline)
        atomic_json(directory / "release.json", old)
        files = ["baseline.json", "release.json", "postgres.dump", "private-config.tar.gz"]
        # This authority lives outside PostgreSQL. Keep the validated bytes in
        # the encrypted snapshot, including the first schema-floor cutover when
        # the previous application still predates Hybrid. Env alone is a path.
        if "HYBRID_LEGACY_MANIFEST_PINS_HOST" in self.environment:
            source, content = policy.legacy_pin_metadata(self.environment, self.base)
            with (directory / "legacy-scope-pins.json").open("xb") as output:
                os.chmod(output.name, 0o600)
                output.write(content)
            atomic_json(directory / "hybrid-metadata.json", {
                "schema": "agritrace-hybrid-metadata-backup/1", "attemptSha": attempt_sha,
                "previousRelease": old["id"], "source": str(source),
                "runtimePath": policy.LEGACY_PINS_TARGET, "file": "legacy-scope-pins.json",
                "sha256": policy.sha256(content), "bytes": len(content), "restoreMode": "0644"})
            files += ["legacy-scope-pins.json", "hybrid-metadata.json"]
        with (directory / "postgres.dump").open("wb") as output:
            os.chmod(output.name, 0o600)
            self.run("postgres-consistent-backup", self.dc(old, "exec", "-T", "postgres", "pg_dump", "--format=custom", "--no-owner", "--no-acl",
                     "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"]), output=output)
        stopped = False
        try:
            if self.fabric:
                stopped = True
                self.run("fabric-stop-for-snapshot", ["docker", "stop", "--time", "20", *self.fabric["containers"]], timeout=180)
                for volume in self.fabric["volumes"]:
                    mount = self.run("ledger-volume-path", ["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", volume]).decode().strip()
                    require(mount == f"/var/lib/docker/volumes/{volume}/_data", "Unexpected ledger volume path")
                self.run("ledger-consistent-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "fabric-ledger.tar.gz"),
                         "-C", "/var/lib/docker/volumes", *[f"{volume}/_data" for volume in self.fabric["volumes"]]])
                self.run("private-identity-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "fabric-identities.tar.gz"),
                         "-C", "/", *[str(Path(p).relative_to("/")) for p in self.fabric["backup_paths"]]])
                files += ["fabric-ledger.tar.gz", "fabric-identities.tar.gz"]
            self.run("private-config-backup", ["tar", "-czf", str(directory / "private-config.tar.gz"), "-C", "/",
                     str(Path(self.config["env"]).relative_to("/")), str(Path(self.config["accounts"]).relative_to("/"))])
            atomic_json(directory / "checksums.json", {name: policy.sha256((directory / name).read_bytes()) for name in files})
            plain = directory / "snapshot.tar"
            self.run("snapshot-bundle", ["tar", "-cf", str(plain), "-C", str(directory), *files, "checksums.json"])
            self.run("encrypted-offsite-backup", ["openssl", "cms", "-encrypt", "-binary", "-aes-256-gcm", "-outform", "DER", "-in", str(plain),
                     "-out", str(directory / "snapshot.cms"), self.config["backup_certificate"]])
            plain.unlink()
            for file in directory.iterdir():
                file.chmod(0o600)
            index_file = self.storage / "backups.json"
            index = json.loads(index_file.read_text()) if index_file.exists() else {}
            index[attempt_sha] = str(directory)
            atomic_json(index_file, index)
        finally:
            if stopped:
                phase = self.phase
                self.resume_fabric()
                self.phase = phase
        return str(directory)


    def resume_fabric(self):
        self.run("fabric-resume", ["docker", "start", *(self.fabric["containers"] if self.target else FABRIC)], timeout=180)
        self.phase = "fabric-readiness"
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            try:
                self.definition()
                return
            except (PolicyError, subprocess.TimeoutExpired):
                self.phase = "fabric-readiness"
                time.sleep(5)
        require(False, "Fabric peers did not become ready; application writers remain stopped")

    def peer_env(self, org):
        if self.target:
            peer = self.fabric["peers"][str(org)]
            environment = dict(os.environ, CORE_PEER_TLS_ENABLED="true", CORE_PEER_LOCALMSPID=peer["msp_id"],
                               CORE_PEER_MSPCONFIGPATH=peer["msp"], CORE_PEER_ADDRESS=peer["address"],
                               CORE_PEER_TLS_ROOTCERT_FILE=peer["tls"], FABRIC_CFG_PATH=self.fabric["config_path"])
            return self.fabric["peer_binary"], environment
        samples = Path(self.config["network_root"]) / "blockchain/.fabric/fabric-samples"
        organizations = samples / "test-network/organizations"
        msp = organizations / f"peerOrganizations/org{org}.example.com/users/Admin@org{org}.example.com/msp"
        tls = organizations / f"peerOrganizations/org{org}.example.com/peers/peer0.org{org}.example.com/tls/ca.crt"
        environment = dict(os.environ, CORE_PEER_TLS_ENABLED="true", CORE_PEER_LOCALMSPID=f"Org{org}MSP", CORE_PEER_MSPCONFIGPATH=str(msp),
                           CORE_PEER_ADDRESS=f"localhost:{7051 if org == 1 else 9051}", CORE_PEER_TLS_ROOTCERT_FILE=str(tls), FABRIC_CFG_PATH=str(samples / "config"))
        return str(samples / "bin/peer"), environment

    def peer(self, label, org, *arguments, timeout=480):
        binary, environment = self.peer_env(org)
        return self.run(label, [binary, "lifecycle", "chaincode", *arguments], env=environment, timeout=timeout)

    def definition(self):
        channel, name = (self.fabric["channel"], self.fabric["chaincode"]) if self.target else ("agritrace", "agritrace")
        results = [json.loads(self.peer("chaincode-query-committed", org, "querycommitted", "--channelID", channel, "--name", name, "--output", "json", timeout=30)) for org in (1, 2)]
        require(results[0] == results[1], "Peers disagree on the committed chaincode definition")
        require(results[0].get("endorsement_plugin") == "escc" and results[0].get("validation_plugin") == "vscc" and
                results[0].get("validation_parameter") == "EiAvQ2hhbm5lbC9BcHBsaWNhdGlvbi9FbmRvcnNlbWVudA==" and
                not results[0].get("collections"), "Custom Fabric policy/collections need separate reviewed lifecycle support")
        return results[0]

    def lifecycle(self, package_ids, version, sequence):
        require(self.fabric_active, "Production Fabric must be active")
        peers = []
        if self.target:
            binding = self.fabric["orderer"]
            orderer = ["-o", binding["address"], "--ordererTLSHostnameOverride", binding["hostname"], "--tls", "--cafile", binding["tls"]]
            definition = ["--channelID", self.fabric["channel"], "--name", self.fabric["chaincode"], "--version", version, "--sequence", str(sequence)]
            peers = [item for peer in self.fabric["peers"].values() for item in ("--peerAddresses", peer["address"], "--tlsRootCertFiles", peer["tls"])]
        else:
            samples = Path(self.config["network_root"]) / "blockchain/.fabric/fabric-samples/test-network/organizations"
            orderer_ca = samples / "ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt"
            orderer = ["-o", "localhost:7050", "--ordererTLSHostnameOverride", "orderer.example.com", "--tls", "--cafile", str(orderer_ca)]
            definition = ["--channelID", "agritrace", "--name", "agritrace", "--version", version, "--sequence", str(sequence)]
            for org, port in ((1, 7051), (2, 9051)):
                tls = samples / f"peerOrganizations/org{org}.example.com/peers/peer0.org{org}.example.com/tls/ca.crt"
                peers += ["--peerAddresses", f"localhost:{port}", "--tlsRootCertFiles", str(tls)]
        for org in (1, 2):
            self.peer("chaincode-approve", org, "approveformyorg", *orderer, *definition, "--package-id", package_ids[str(org)], "--waitForEvent", "--waitForEventTimeout", "60s")
        ready = json.loads(self.peer("chaincode-commit-readiness", 1, "checkcommitreadiness", *definition, "--output", "json"))
        msps = [peer["msp_id"] for peer in self.fabric["peers"].values()] if self.target else ["Org1MSP", "Org2MSP"]
        require(all(ready.get("approvals", {}).get(msp) for msp in msps), "Both organizations must approve the definition")
        try:
            self.peer("chaincode-commit", 1, "commit", *orderer, *definition, *peers, "--waitForEvent", "--waitForEventTimeout", "60s")
        except (PolicyError, subprocess.TimeoutExpired):
            # A timeout can be a committed transaction; reconcile before retry.
            actual = self.definition()
            require(actual.get("sequence") == sequence and actual.get("version") == version, "Chaincode commit outcome requires recovery")
        actual = self.definition()
        require(actual.get("sequence") == sequence and actual.get("version") == version, "Committed definition mismatch")
        return {"sequence": sequence, "version": version, "packages": package_ids}

    def upgrade(self, candidate, expected_sequence):
        actual = self.definition()
        require(actual["sequence"] == expected_sequence, "Chaincode sequence changed; upgrade blocked")
        package = self.storage / "records" / candidate["id"] / "chaincode.tgz"
        self.peer("chaincode-package", 1, "package", str(package), "--path", str(Path(candidate["directory"]) / "blockchain/chaincode"),
                  "--lang", "node", "--label", f"agritrace-{candidate['sha']}")
        package_id = self.peer("chaincode-package-id", 1, "calculatepackageid", str(package)).decode().strip()
        require(package_id.startswith(f"agritrace-{candidate['sha']}:") and policy.DIGEST.fullmatch(package_id.split(":")[-1]), "Invalid chaincode package ID")
        for org in (1, 2):
            installed = json.loads(self.peer("chaincode-installed-packages", org, "queryinstalled", "--output", "json"))
            if package_id not in {entry["package_id"] for entry in installed.get("installed_chaincodes", [])}:
                self.peer("chaincode-install", org, "install", str(package))
        return self.lifecycle({"1": package_id, "2": package_id}, f"cd-{candidate['sha'][:12]}", expected_sequence + 1)

    def restore_definition(self, state, previous):
        actual = self.definition()
        known = state["chaincode"]
        # A crash after switch() can leave the candidate in state while the
        # journal still requests the previous release. Recover its historical
        # package, rather than starting old application code against new code.
        if known["fingerprint"] != previous["manifest"]["chaincode"]:
            known = previous.get("chaincode")
            require(known is not None and known["fingerprint"] == previous["manifest"]["chaincode"],
                    "Previous release chaincode package metadata is missing")
        if actual["sequence"] == known["sequence"] and actual["version"] == known["version"]:
            return known
        # Restore old package through a higher sequence; never rewind ledger.
        result = self.lifecycle(known["packages"], f"rollback-{previous['sha'][:12]}-{actual['sequence'] + 1}", actual["sequence"] + 1)
        result["fingerprint"] = known["fingerprint"]
        return result

    def switch(self, record, state):
        link = self.base / "current.next"
        if link.is_symlink():
            link.unlink()
        require(not link.exists(), "Unexpected current.next path")
        link.symlink_to(record["directory"], target_is_directory=True)
        os.replace(link, self.base / "current")
        sync_directory(self.base)
        atomic_json(self.storage / "state.json", state)

    @staticmethod
    def preserve(before, after):
        require(all(after["fingerprints"].get(key) == value for key, value in before["fingerprints"].items()), "Existing event/proof history changed")
        for table, count in before["counts"].items():
            require(after["counts"].get(table, -1) >= count, "Existing data count decreased")

    def rollback_to(self, target, state, before=None):
        current = self.record(state["current"])
        target_record = self.record(target)
        policy.migrations(self.applied(current), target_record["manifest"]["migrations"], target_record["directory"], state.get("compatible_migrations", []))
        # Code rollback across a different chaincode requires its historical package.
        chaincode = state["chaincode"]
        if target_record["manifest"]["chaincode"] != chaincode["fingerprint"]:
            old_chaincode = target_record.get("chaincode")
            require(old_chaincode is not None, "Historical chaincode package metadata is missing")
            actual = self.definition()
            chaincode = self.lifecycle(old_chaincode["packages"], f"rollback-{target_record['sha'][:12]}-{actual['sequence'] + 1}", actual["sequence"] + 1)
            chaincode["fingerprint"] = target_record["manifest"]["chaincode"]
        self.prepare_compatible_start(target_record)
        self.start(target_record)
        evidence = self.verify(target_record)
        if before:
            self.preserve(before, evidence)
        updated = dict(state, current=target, previous=state["current"], chaincode=chaincode)
        self.switch(target_record, updated)
        return updated, evidence


    def rollout(self, candidate, state, expected_sequence=None, auth=None):
        old = self.record(state["current"])
        # Only an administrator's reviewed cutover may establish this catalog.
        # A routine release must not widen the legacy sensor exception.
        candidate["legacyQrLotIds"] = list(old.get("legacyQrLotIds", []))
        require(not (self.storage / "journal.json").exists(), "Interrupted deployment needs recover before a new rollout")
        self.preflight(candidate)
        if expected_sequence is None:
            require(candidate["manifest"]["chaincode"] == state["chaincode"]["fingerprint"], "Chaincode changed; dispatch upgrade with expected sequence")
        applied = self.applied(old)
        first_floor = policy.scope_floor_admission(candidate["manifest"], candidate["sha"], applied, self.environment)
        require(not first_floor or expected_sequence is None, "First schema-floor cutover cannot also upgrade chaincode")
        require(not first_floor or auth is not None, "First schema-floor cutover requires exact CI revalidation credentials")
        metadata_digest = self.metadata_digest() if first_floor else None
        new_migrations = policy.migrations(applied, candidate["manifest"]["migrations"], candidate["directory"])
        if expected_sequence is not None:
            require(self.definition()["sequence"] == expected_sequence, "Expected chaincode sequence mismatch")
        before = self.verify(old)
        self.journal(old, candidate, "snapshot", before)
        chaincode = state["chaincode"]
        snapshot = None
        try:
            self.stop(old)
            before = self.quiescent_baseline(old, before)
            self.journal(old, candidate, "snapshot", before)
            snapshot = self.snapshot(old, candidate["sha"], before)
            self.journal(old, candidate, "migration")
            if first_floor:
                reference = self.snapshot_reference(snapshot, candidate["sha"])
                require(self.metadata_digest() == metadata_digest,
                        "Independent Hybrid metadata changed during cutover backup")
                journal = json.loads((self.storage / "journal.json").read_text())
                journal["scopeCutover"] = {"sourceSha": candidate["sha"], "originalCandidate": candidate["id"],
                                          "migrations": candidate["manifest"]["migrations"], "metadataDigest": metadata_digest,
                                          "chaincode": state["chaincode"], "snapshot": reference}
                atomic_json(self.storage / "journal.json", journal)
            self.migrate(candidate)
            if expected_sequence is not None:
                self.journal(old, candidate, "chaincode")
                chaincode = self.upgrade(candidate, expected_sequence)
                chaincode["fingerprint"] = candidate["manifest"]["chaincode"]
            self.journal(old, candidate, "application")
            self.hybrid_readiness(candidate)
            if first_floor:
                self.server_gate(candidate, auth)
                actual = self.definition()
                require(actual.get("sequence") == state["chaincode"]["sequence"] and
                        actual.get("version") == state["chaincode"]["version"],
                        "Actual Fabric definition changed before cutover writer startup")
                require(self.metadata_digest() == metadata_digest,
                        "Independent Hybrid metadata changed before writer startup")
            self.start(candidate)
            evidence = self.verify(candidate, candidate["sha"])
            self.preserve(before, evidence)
            candidate["verified"] = True
            candidate["sessionContract"] = "family-v1"
            candidate["chaincode"] = chaincode
            self.save_record(candidate)
            updated = dict(state, current=candidate["id"], previous=old["id"] if old["id"] != candidate["id"] else state.get("previous"),
                           chaincode=chaincode, compatible_migrations=sorted(set(state.get("compatible_migrations", [])) | set(new_migrations)))
            self.switch(candidate, updated)
            atomic_json(self.storage / "last-result.json", {"result": "passed", "sha": candidate["sha"], "release": candidate["id"], "snapshot": snapshot,
                       "counts": evidence["counts"], "canary": evidence["canary"], "chaincode": chaincode})
            self.clear_journal()
            return {"result": "passed", "release": candidate["id"], "counts": evidence["counts"], "chaincodeSequence": chaincode["sequence"]}
        except Exception as error:
            failed_phase = self.phase
            try:
                with self.stop_on_failure(old):
                    self.stop(candidate)
                    self.resume_fabric()
                    compatible = self.recovery_migrations(old, candidate, state)
                    restored = self.restore_definition(state, old)
                    self.prepare_compatible_start(old)
                    self.start(old)
                    evidence = self.verify(old)
                    self.preserve(before, evidence)
                    # Expanded schema stays; compatible migration names remain known for recovery.
                    restored_state = dict(state, chaincode=restored, compatible_migrations=compatible)
                    self.switch(old, restored_state)
                    self.clear_journal()
                rollback = "verified"
            except Exception:
                rollback = "recovery-required"
            atomic_json(self.storage / "last-result.json", {"result": "failed", "sha": candidate["sha"], "phase": failed_phase, "rollback": rollback, "snapshot": snapshot})
            raise PolicyError(f"Release failed at {failed_phase}; rollback={rollback}; database and ledger were not restored") from error

    def forward(self, candidate, state, auth):
        filename = self.storage / "journal.json"
        require(filename.exists(), "Forward recovery requires an interrupted first-floor cutover")
        journal = json.loads(filename.read_text())
        failed = self.record(journal["candidate"])
        with self.stop_on_failure(failed):
            return self.forward_candidate(candidate, state, auth)

    def forward_candidate(self, candidate, state, auth):
        filename = self.storage / "journal.json"
        require(filename.exists(), "Forward recovery requires an interrupted first-floor cutover")
        journal = json.loads(filename.read_text())
        cutover = journal.get("scopeCutover")
        require(isinstance(cutover, dict) and journal.get("baseline") and journal.get("previous"),
                "Forward recovery requires the cutover admission, quiescent baseline and completed backup")
        original = self.record(cutover["originalCandidate"])
        previous = self.record(journal["previous"])
        failed = self.record(journal["candidate"])
        attempts = journal.get("forwardAttempts", [])
        known = {previous["id"], original["id"], failed["id"], *attempts}
        require(state["current"] in known and len(attempts) < 100, "Forward recovery state is outside the pinned cutover")
        current = self.base / "current"
        require(current.is_symlink() and current.resolve() in {Path(self.record(name)["directory"]).resolve() for name in known},
                "Current release link is outside the pinned cutover attempts")
        require(not policy.REQUIRED_RELEASE_MIGRATIONS <= set(previous["manifest"]["migrations"]),
                "Forward recovery is reserved for the first schema-floor cutover")
        require(candidate["manifest"]["migrations"] == cutover["migrations"] == original["manifest"]["migrations"] and
                policy.REQUIRED_RELEASE_MIGRATIONS <= set(cutover["migrations"]),
                "Forward recovery must keep the exact reviewed migration catalog")
        require(self.environment.get("HYBRID_SCOPE_CUTOVER_SHA") == cutover["sourceSha"] == original["sha"],
                "Forward recovery lost the original independent cutover acknowledgement")
        require(candidate["manifest"]["chaincode"] == cutover["chaincode"]["fingerprint"] == state["chaincode"]["fingerprint"],
                "Forward recovery cannot change the chaincode package")
        require(self.metadata_digest() == cutover["metadataDigest"],
                "Independent Hybrid metadata changed since cutover admission")
        reference = cutover["snapshot"]
        require(self.snapshot_reference(reference["directory"], reference["sourceSha"]) == reference,
                "The original cutover snapshot changed")
        candidate["legacyQrLotIds"] = list(previous.get("legacyQrLotIds", []))
        self.preflight(candidate)
        # These checks run before touching the existing journal or starting
        # writers. An unfinished Prisma row is never resolved automatically.
        policy.migrations(self.applied(failed), candidate["manifest"]["migrations"], candidate["directory"])
        require(state["chaincode"] == cutover["chaincode"], "Cutover chaincode state changed")
        self.server_gate(candidate, auth)
        if candidate["id"] not in attempts:
            attempts.append(candidate["id"])
        journal.update(candidate=candidate["id"], forwardAttempts=attempts, stage="forward-migration")
        atomic_json(filename, journal)
        try:
            with self.stop_on_failure(candidate):
                self.stop(failed)
                self.resume_fabric()
                self.phase = "forward-fabric-binding"
                actual = self.definition()
                require(actual.get("sequence") == cutover["chaincode"]["sequence"] and
                        actual.get("version") == cutover["chaincode"]["version"],
                        "Actual Fabric definition changed; forward recovery is held")
                self.migrate(candidate)
                applied = self.applied(candidate)
                require(set(applied) == set(candidate["manifest"]["migrations"]) and
                        not policy.migrations(applied, candidate["manifest"]["migrations"], candidate["directory"]),
                        "Forward recovery did not finish the exact migration catalog")
                self.hybrid_readiness(candidate)
                require(self.metadata_digest() == cutover["metadataDigest"],
                        "Independent Hybrid metadata changed before forward startup")
                self.server_gate(candidate, auth)
                self.journal(previous, candidate, "forward-application")
                self.phase = "forward-final-admission"
                actual = self.definition()
                require(actual.get("sequence") == cutover["chaincode"]["sequence"] and
                        actual.get("version") == cutover["chaincode"]["version"],
                        "Actual Fabric definition changed before writer startup")
                require(self.metadata_digest() == cutover["metadataDigest"],
                        "Independent Hybrid metadata changed before writer startup")
                self.start(candidate)
                evidence = self.verify(candidate, candidate["sha"])
                self.preserve(journal["baseline"], evidence)
                candidate.update(verified=True, sessionContract="family-v1", chaincode=cutover["chaincode"])
                self.save_record(candidate)
                self.switch(candidate, dict(state, current=candidate["id"], previous=previous["id"],
                            compatible_migrations=sorted(set(state.get("compatible_migrations", [])) | set(cutover["migrations"]))))
                index = json.loads((self.storage / "backups.json").read_text())
                require(candidate["sha"] not in index or index[candidate["sha"]] == reference["directory"],
                        "Forward recovery cannot replace a previously saved snapshot")
                index[candidate["sha"]] = reference["directory"]
                atomic_json(self.storage / "backups.json", index)
                atomic_json(self.storage / "last-result.json", {"result": "passed", "operation": "forward",
                            "sha": candidate["sha"], "release": candidate["id"], "snapshot": reference,
                            "counts": evidence["counts"], "canary": evidence["canary"], "chaincode": cutover["chaincode"]})
                self.clear_journal()
            return {"result": "forward-recovered", "release": candidate["id"], "snapshotSourceSha": reference["sourceSha"],
                    "counts": evidence["counts"], "chaincodeSequence": cutover["chaincode"]["sequence"]}
        except Exception as error:
            atomic_json(self.storage / "last-result.json", {"result": "failed", "operation": "forward",
                        "sha": candidate["sha"], "phase": self.phase, "snapshot": reference, "journalRetained": True})
            raise PolicyError(f"Forward recovery failed at {self.phase}; journal retained and writers require reconciliation") from error

    def recovery_migrations(self, previous, candidate, state):
        applied = self.applied(previous)
        additions = sorted(set(applied) - set(previous["manifest"]["migrations"]))
        compatible = set(state.get("compatible_migrations", []))
        policy.migrations(applied, candidate["manifest"]["migrations"], candidate["directory"], compatible)
        policy.migrations(applied, previous["manifest"]["migrations"], previous["directory"], compatible | set(additions))
        for name in additions:
            if name in compatible:
                continue
            script = (Path(candidate["directory"]) / "apps/api/prisma/migrations" / name / "migration.sql").read_bytes()
            require(policy.sha256(script) == candidate["manifest"]["migrations"].get(name), "Unexpected migration after interrupted deploy")
            policy.additive_sql(script.decode("utf-8"))
        return sorted(compatible | set(additions))

    def recover(self):
        if not (self.storage / "journal.json").exists():
            return {"result": "no-recovery-required", "release": self.state()["current"]}
        journal = json.loads((self.storage / "journal.json").read_text())
        require(journal.get("previous") is not None, "Production recovery requires a verified previous release")
        state = self.state()
        previous = self.record(journal["previous"])
        candidate = self.record(journal["candidate"])
        with self.stop_on_failure(previous):
            self.stop(candidate)
            self.resume_fabric()
            # A completed migration from an interrupted release still requires compatibility validation.
            compatible = self.recovery_migrations(previous, candidate, state)
            chaincode = self.restore_definition(state, previous)
            self.prepare_compatible_start(previous)
            self.start(previous)
            evidence = self.verify(previous)
            if journal.get("baseline"):
                self.preserve(journal["baseline"], evidence)
            self.switch(previous, dict(state, current=previous["id"],
                        previous=state["current"] if state["current"] != previous["id"] else state.get("previous"), chaincode=chaincode,
                        compatible_migrations=compatible))
            self.clear_journal()
        return {"result": "recovered", "release": previous["id"], "counts": evidence["counts"]}



    def execute(self, parts, stream):
        op = parts[0]
        if op == "status":
            state = self.state()
            return {"result": "passed", "current": state["current"], "previous": state.get("previous"), "chaincodeSequence": state["chaincode"]["sequence"],
                    "recoveryRequired": (self.storage / "journal.json").exists()}
        if op == "backup":
            index = json.loads((self.storage / "backups.json").read_text())
            require(parts[1] in index, "No completed encrypted snapshot for this commit")
            source = Path(index[parts[1]]) / "snapshot.cms"
            require(source.resolve().is_relative_to((self.base / "backups").resolve()), "Unexpected backup path")
            with source.open("rb") as file:
                shutil.copyfileobj(file, sys.stdout.buffer)
            return None
        if op == "recover":
            return self.recover()
        require(self.config.get("enabled", True), "Deployment is disabled for this environment")
        require(not (self.storage / "runtime-toggle.json").exists(), "Administrator must finish the interrupted Fabric runtime switch")
        state = self.state()
        require(state["current"] is not None, "Production requires an adopted verified release")
        if op == "rollback":
            require(not (self.storage / "journal.json").exists(), "Recover interrupted rollout before rollback")
            target = self.prefix + "-" + parts[1]
            if self.target and self.prefix == "prod" and not (self.storage / "records" / target / "record.json").exists():
                target = "uat-" + parts[1]
            if target != state["current"]:
                record = self.record(target)
                require(record.get("verified"), "Rollback target was not verified")
                if state.get("coreRollbackFloor"):
                    floor = self.record(state["coreRollbackFloor"])["manifest"]["migrations"]
                    require(all(record["manifest"]["migrations"].get(k) == v for k, v in floor.items()), "Rollback crosses the protected core migration floor")
                old = self.record(state["current"])
                before = self.verify(old)
                # Validate compatibility before stopping any service.
                policy.migrations(self.applied(old), record["manifest"]["migrations"], record["directory"], state.get("compatible_migrations", []))
                self.journal(old, record, "rollback", before)
                try:
                    with self.stop_on_failure(record):
                        self.stop(old)
                        before = self.quiescent_baseline(old, before)
                        self.journal(old, record, "rollback", before)
                        self.snapshot(old, parts[1], before)
                        _, evidence = self.rollback_to(target, state, before)
                        self.clear_journal()
                    return {"result": "rolled-back", "release": target, "counts": evidence["counts"]}
                except Exception:
                    # Journal preserves an explicit recover path; no implicit data restore.
                    raise PolicyError("Rollback did not complete; run recover to restore the previous verified application")
            return {"result": "unchanged", "release": target}
        # This must precede transport/record writes and the same-SHA fast path.
        if op == "forward":
            require((self.storage / "journal.json").exists(), "Forward recovery requires an interrupted cutover")
        else:
            require(not (self.storage / "journal.json").exists(), "Interrupted deployment needs recover before a new rollout")
        header = stream.readline(policy.MAX_AUTH_HEADER + 1)
        require(len(header) <= policy.MAX_AUTH_HEADER and header.endswith(b"\n"), "Invalid registry authentication framing")
        auth = json.loads(header)
        policy.registry_auth(auth)
        with tempfile.TemporaryDirectory(prefix="incoming-", dir=self.storage) as temporary:
            archive = Path(temporary) / "release.tar.gz"
            total = 0
            with archive.open("wb") as output:
                while True:
                    chunk = stream.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    require(total <= 16 * 1024 * 1024, "Release transport exceeded size limit")
                    output.write(chunk)
            require(policy.sha256(archive.read_bytes()) == parts[2], "Release transport checksum mismatch")
            release = self.prefix + "-" + parts[1]
            destination = Path(temporary) / "validated"
            manifest = policy.extract(archive, destination, parts[1], self.config["repository"], self.config["origin"], self.target)
            final = self.base / "releases" / release
            if final.exists():
                record = self.record(release)
                require(record["manifest"] == manifest, "Existing release content differs from candidate")
                for name, digest in manifest["files"].items():
                    require(policy.sha256((final / name).read_bytes()) == digest, "Existing release was modified")
            else:
                os.rename(destination, final)
                record = {"id": release, "sha": parts[1], "directory": str(final), "manifest": manifest, "verified": False}
                self.save_record(record)
            self.server_gate(record, auth)
            if state["current"] == release and op == "deploy":
                evidence = self.verify(record)
                return {"result": "unchanged", "release": release, "counts": evidence["counts"]}
            self.registry(record, auth)
            require(state["current"] is not None, "Production requires an adopted verified release")
            if op == "forward":
                return self.forward(record, state, auth)
            return self.rollout(record, state, int(parts[3]) if op == "upgrade" else None, auth=auth)


def main():
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument("--command", required=True)
    parser.add_argument("--config", default="/etc/agri-trace-cd/config.json")
    args = parser.parse_args()
    parts = policy.command(args.command)
    config = json.loads(Path(args.config).read_text())
    require(os.getuid() == 0, "Installed CD controller requires root")
    os.umask(0o077)
    controller = Controller(config)
    with (controller.storage / "delivery.lock").open("a") as lock:
        if parts[0] not in {"status", "backup"}:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise PolicyError("Another delivery is running; no services were changed")
        # Always acquire environment then host lock; both fail immediately.
        # Status/backup are read-only. Edge administration uses its own lock.
        with contextlib.ExitStack() as stack:
            if controller.target and parts[0] not in {"status", "backup"}:
                host_lock = stack.enter_context(Path(config["host_lock"]).open("a"))
                try:
                    fcntl.flock(host_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise PolicyError("Another host deployment is running; no services were changed")
            result = controller.execute(parts, sys.stdin.buffer)
        if result is not None:
            print(json.dumps(result), flush=True)


if __name__ == "__main__":
    def interrupted(*_):
        raise PolicyError("Delivery process was interrupted")
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    try:
        main()
    except Exception as error:
        message = str(error) if isinstance(error, PolicyError) else "CD failed; inspect private VPS diagnostics and recovery journal"
        print(json.dumps({"result": "failed", "message": message}), file=sys.stderr)
        sys.exit(1)
