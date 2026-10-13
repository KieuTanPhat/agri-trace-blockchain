#!/usr/bin/env python3
"""Transactional delivery. This installed file is root-owned, not run from a release."""
import argparse
import contextlib
import datetime
import importlib.util
import json
import os
import re
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
    descriptor = os.open(filename.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class Controller:
    def __init__(self, config):
        self.config = config
        require(config.get("schema") in (None, 2, 3) and ("environment" not in config or config.get("schema") in (2, 3)), "Unsupported installed config schema")
        self.fresh = config.get("schema") == 3
        self.target = policy.targets.validate_config(config, require) if config.get("schema") in (2, 3) else None
        self.fabric_active = True  # Production and retained UAT releases require Fabric.
        self.project = config["project"] if self.target else "agri-trace-uat"
        self.prefix = policy.targets.TARGETS[config["environment"]]["prefix"] if self.target else "uat"
        self.fabric = config.get("hosted", {}) if self.fresh else config.get("fabric") or {}
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

    def fresh_write_mode(self, record):
        if getattr(self, "smoke_writes", False):
            return "OPEN"
        if (self.storage / "journal.json").exists() or not record.get("verified"):
            return "CLOSED"
        return "OPEN" if self.config.get("open_after_smoke") is True else self.config.get("writes_mode", "CLOSED")

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
            if self.fresh:
                values["HYBRID_WRITES_MODE"] = self.fresh_write_mode(record)
                values["FABRIC_LEGACY_WRITER"] = "false"
            elif any(policy.HYBRID_MIGRATION.match(name) for name in record["manifest"]["migrations"]):
                # First activation is always canary. A verified release opens
                # ordinary writes only with a separate installed acknowledgement.
                acknowledgement = self.config.get("hybrid_open_ack", {})
                manifest_digest = policy.sha256(json.dumps(record["manifest"], sort_keys=True, separators=(",", ":")).encode())
                opened = record.get("verified") and acknowledgement.get("sha") == record["sha"] and acknowledgement.get("manifest_sha256") == manifest_digest
                values["HYBRID_WRITES_MODE"] = "OPEN" if opened else "CANARY"
                values["HYBRID_CANARY_ACTOR_IDS"] = self.environment.get("HYBRID_CANARY_ACTOR_IDS", "")
            resources = self.config.get("resource_profile", {})
            for name in ("POSTGRES", "API", "WORKER", "WEB"):
                if name in resources:
                    require(type(resources[name]) is int and 128 <= resources[name] <= 4096, "Invalid reviewed app resource profile")
                    values[name + "_MEMORY"] = str(resources[name]) + "m"
                    if name != "POSTGRES":
                        values[name + "_HEAP_MB"] = str(max(96, resources[name] - 128))
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
            if not self.fresh:
                compose_files += ["-f", str(root / "docker-compose.app-fabric.yml")]
            if any(policy.HYBRID_MIGRATION.match(name) for name in record["manifest"]["migrations"]):
                require("docker-compose.app-hybrid.yml" in record["manifest"]["files"], "Hybrid connection overlay is missing")
                compose_files += ["-f", str(root / "docker-compose.app-hybrid.yml")]
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
        if self.fresh:
            return self.hosted_preflight(record, model)
        policy.validate_manifest(record["manifest"], record["sha"], self.config["repository"], self.config["origin"], self.target)
        require(model["name"] == self.project, "Compose project changed")
        services = model["services"]
        require({"postgres", "migrate", "api", "web"} <= set(services) <= {"postgres", "migrate", "api", "worker", "web"}, "Unexpected app services")
        require(model["volumes"]["postgres-data"]["name"] == self.config["postgres_volume"], "Database volume changed")
        require(model["networks"]["default"]["name"] == self.project + "_default" and
                model["networks"]["ingress"]["external"] and model["networks"]["ingress"]["name"] == self.config["ingress"], "App network changed")
        hybrid = any(policy.HYBRID_MIGRATION.match(name) for name in record["manifest"]["migrations"])
        allowed_networks = {"default", "ingress", "fabric"} | ({"hosted"} if hybrid else set())
        require(set(model["networks"]) == allowed_networks, "Unexpected app network")
        expected_database = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@postgres:5432/{self.environment['POSTGRES_DB']}?schema=public"
        for name, service in services.items():
            require(not any(service.get(k) for k in ("ports", "privileged", "cap_add", "devices", "network_mode", "pid", "extra_hosts", "secrets")), "Unexpected container privilege/port/secret")
            require(set(service.get("networks", {})) == ({"default", "ingress"} if name in {"api", "web"} else
                    {"default", "fabric"} | ({"hosted"} if hybrid else set()) if name == "worker" else {"default"}), "Unexpected service network")
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
        if hybrid:
            require(api.get("HYBRID_WRITES_MODE") in {"CLOSED", "CANARY", "OPEN"}, "Hybrid writer maintenance mode is missing")
            if api["HYBRID_WRITES_MODE"] == "CANARY":
                actors = api.get("HYBRID_CANARY_ACTOR_IDS", "").split(",")
                require(bool(actors) and all(re.fullmatch(r"[a-f0-9-]{36}", actor) for actor in actors), "Canary writer mode needs reviewed technical actors")
            require("chainId" in self.config["canary"], "Hybrid canary requires reviewed current chainId/actor grants")
            metadata = services["api"].get("volumes", [])
            require(len(metadata) == 1 and metadata[0]["target"] == "/legacy-ledger/descriptor.json" and
                    metadata[0]["source"] == self.environment["LEGACY_LEDGER_DESCRIPTOR_HOST"] and metadata[0].get("read_only") and
                    not metadata[0].get("bind", {}).get("create_host_path"), "API may receive only pinned public history metadata")
            require(api.get("LEGACY_LEDGER_DESCRIPTOR_SHA256") == self.environment["LEGACY_LEDGER_DESCRIPTOR_SHA256"] and
                    policy.sha256(Path(self.environment["LEGACY_LEDGER_DESCRIPTOR_HOST"]).read_bytes()) == self.environment["LEGACY_LEDGER_DESCRIPTOR_SHA256"],
                    "Historical descriptor checksum changed")
            require(model["networks"]["hosted"]["external"] and model["networks"]["hosted"]["name"] == self.config.get("hosted", {}).get("network"),
                    "Hosted network differs from its installed descriptor")
            self.capacity_preflight(services)
        require(services["web"]["environment"].get("API_INTERNAL_BASE_URL") == "http://api:8080/api", "SSR API boundary changed")
        for name in ("api", "web"):
            require(services[name]["networks"]["ingress"].get("aliases", []) == [self.prefix + "-" + name], "Ingress alias changed")
        worker = services["worker"]
        require(model["networks"]["fabric"]["external"] and model["networks"]["fabric"]["name"] == self.fabric["network"], "Fabric network changed")
        require(worker["environment"]["FABRIC_ENABLED"] == "true" and worker["environment"]["FABRIC_CHANNEL_NAME"] == self.fabric["channel"] and
                worker["environment"]["FABRIC_CHAINCODE_NAME"] == self.fabric["chaincode"] and
                worker["user"] == f"{self.environment['WORKER_UID']}:{self.environment['WORKER_GID']}", "Worker signing boundary changed")
        mounts = {mount["target"]: mount for mount in worker.get("volumes", [])}
        required_mounts = {"/fabric-identity": "RELAYER_MSP_DIR_HOST", "/fabric-tls/ca.crt": "FABRIC_TLS_CERT_HOST"}
        if hybrid:
            required_mounts.update({"/legacy-ledger/descriptor.json": "LEGACY_LEDGER_DESCRIPTOR_HOST",
                                    "/hosted-config/bindings.json": "FABRIC_BINDINGS_CONFIG_HOST", "/hosted-identities": "HOSTED_WORKER_IDENTITIES_HOST"})
            require(worker["environment"].get("FABRIC_BINDINGS_CONFIG") == "/hosted-config/bindings.json" and
                    worker["environment"].get("LEDGER_WRITER_AUTHORITY") == self.environment["LEDGER_WRITER_AUTHORITY"], "Worker binding/logical authority changed")
        require(set(mounts) == set(required_mounts), "Worker mount set changed")
        for path, key in required_mounts.items():
            require(mounts[path]["source"] == self.environment[key] and mounts[path].get("read_only") and
                    not mounts[path].get("bind", {}).get("create_host_path"), "Worker signing mount changed")

    def hosted_preflight(self, record, model):
        policy.validate_manifest(record["manifest"], record["sha"], self.config["repository"], self.config["origin"], self.target)
        require(model["name"] == self.project, "Compose project changed")
        services = model["services"]
        require(set(services) == {"postgres", "migrate", "api", "worker", "web"}, "Unexpected hosted app services")
        require(set(model["networks"]) == {"default", "ingress", "hosted"}, "Fresh app must use only its hosted network")
        require(model["volumes"]["postgres-data"]["name"] == self.config["postgres_volume"], "Database volume changed")
        require(model["networks"]["default"]["name"] == self.project + "_default" and
                model["networks"]["ingress"]["external"] and model["networks"]["ingress"]["name"] == self.config["ingress"] and
                model["networks"]["hosted"]["external"] and model["networks"]["hosted"]["name"] == self.fabric["network"], "Hosted app network changed")
        database = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@postgres:5432/{self.environment['POSTGRES_DB']}?schema=public"
        for name, service in services.items():
            require(not any(service.get(k) for k in ("ports", "privileged", "cap_add", "devices", "network_mode", "pid", "extra_hosts", "secrets")), "Unexpected container privilege or public port")
            expected = {"default", "ingress"} if name in {"api", "web"} else {"default", "hosted"} if name == "worker" else {"default"}
            require(set(service.get("networks", {})) == expected, "Unexpected hosted service network")
            if name not in {"web", "postgres"}:
                require(service["environment"]["DATABASE_URL"] == database, "Database configuration changed")
            if name in {"api", "web", "migrate"}:
                require(not service.get("volumes"), "Public/tool service received host identities")
            if name in {"api", "worker", "migrate", "web"}:
                expected_image = record["manifest"]["web" if name == "web" else "api"]
                require(service["image"] == expected_image, "Hosted app image differs from release")
        require(services["postgres"]["image"] == self.environment["POSTGRES_IMAGE"], "Database image changed")
        for key in ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD"):
            require(services["postgres"]["environment"][key] == self.environment[key], "Hosted database initialization changed")
        mounts = services["postgres"].get("volumes", [])
        require(len(mounts) == 1 and mounts[0].get("source") == "postgres-data" and mounts[0].get("target") == "/var/lib/postgresql", "Database mount changed")
        api = services["api"]["environment"]
        require(api["FABRIC_ENABLED"] == "false" and api["FABRIC_LEGACY_WRITER"] == "false" and
                api["HYBRID_WRITES_MODE"] == self.fresh_write_mode(record) and
                api["JWT_SECRET"] == self.environment["JWT_SECRET"] and
                api["CORS_ORIGIN"] == self.environment["CORS_ORIGINS"] and
                api["PUBLIC_TRACE_BASE_URL"] == self.config["origin"] + "/trace", "Hosted API maintenance/auth boundary changed")
        require(set(self.environment["CORS_ORIGINS"].split(",")) == set(policy.https_origins(self.config["origin"])), "Cross-environment CORS is forbidden")
        require(services["web"]["environment"]["API_INTERNAL_BASE_URL"] == "http://api:8080/api", "SSR API boundary changed")
        for name in ("api", "web"):
            require(services[name]["networks"]["ingress"].get("aliases", []) == [self.prefix + "-" + name], "Ingress alias changed")
        worker = services["worker"]
        require(worker["environment"]["FABRIC_ENABLED"] == "true" and worker["environment"]["FABRIC_LEGACY_WRITER"] == "false" and
                worker["user"] == f"{self.environment['WORKER_UID']}:{self.environment['WORKER_GID']}", "Hosted Worker identity boundary changed")
        expected_mounts = {"/hosted-config/bindings.json": "FABRIC_BINDINGS_CONFIG_HOST", "/hosted-identities": "HOSTED_WORKER_IDENTITIES_HOST"}
        mounted = {mount["target"]: mount for mount in worker.get("volumes", [])}
        require(set(mounted) == set(expected_mounts), "Hosted Worker mount set changed")
        for target, key in expected_mounts.items():
            mount = mounted[target]
            require(mount["source"] == self.environment[key] and mount.get("read_only") and
                    not mount.get("bind", {}).get("create_host_path"), "Hosted identity mount changed")
        self.capacity_preflight(services)

    def capacity_preflight(self, services):
        memory = re.search(r"^MemTotal:\s+(\d+) kB$", Path("/proc/meminfo").read_text(), re.M)
        require(memory is not None, "Host capacity could not be established")
        names = self.run("capacity-runtime-catalog", ["docker", "ps", "-q"]).decode().split()
        require(bool(names), "Runtime capacity catalog is empty")
        current = json.loads(self.run("capacity-runtime-limits", ["docker", "inspect", *names]))
        limits = {}
        for resource in current:
            labels = resource.get("Config", {}).get("Labels", {}) or {}
            if labels.get("com.docker.compose.project") == self.project:
                continue  # Candidate app limits below replace the current app.
            host = resource["HostConfig"]
            require(host.get("NanoCpus", 0) > 0 or (host.get("CpuQuota", 0) > 0 and host.get("CpuPeriod", 0) > 0),
                    "Every retained/hosted container needs an explicit CPU quota")
            limits[resource["Name"]] = host.get("Memory", 0)
        for name, service in services.items():
            if name == "migrate":
                continue  # Migration is separate from the stopped-writer runtime.
            require(float(service.get("cpus", 0)) > 0, "Candidate app CPU quota is missing")
            limits["candidate:" + name] = service.get("mem_limit", 0)
        if self.fresh:
            limits["candidate:temporary-operator"] = 384 * 1024 * 1024
        admitted = policy.capacity_budget(int(memory[1]) * 1024, limits)
        atomic_json(self.storage / "capacity-admission.json", admitted)

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

    def hybrid_floor(self):
        filename = self.storage / "hybrid-floor.json"
        if not filename.exists():
            return {}
        value = json.loads(filename.read_text())
        require(value.get("protocol") == "hybrid-abc/1" and isinstance(value.get("migrations"), dict), "Invalid installed Hybrid floor")
        return value["migrations"]

    def migration_policy(self, applied, record, compatible=()):
        return policy.migrations(applied, record["manifest"]["migrations"], record["directory"], compatible,
                                 reviewed=self.config.get("migration_reviews", {}), floor=self.hybrid_floor())

    def protect_hybrid_schema(self, record):
        reviews = policy.reviewed_migrations(self.config.get("migration_reviews", {}))
        floor = dict(self.hybrid_floor())
        for name, digest in record["manifest"]["migrations"].items():
            if policy.HYBRID_MIGRATION.match(name) or name in reviews:
                require(reviews.get(name, {}).get("checksum") == digest,
                        "Hybrid floor requires exact installed migration reviews")
                floor[name] = digest
        if floor:
            # Persist before migrate: even a crash/partial SQL must not resume a
            # pre-Hybrid writer. This file is independent of release state and
            # the additive compatible_migrations allowlist.
            atomic_json(self.storage / "hybrid-floor.json", {"protocol": "hybrid-abc/1", "sha": record["sha"], "migrations": floor})

    @staticmethod
    def legacy_fingerprint(record):
        # B/C source belongs to the new hosted channel. Its package is never
        # substituted for the retained legacy channel's definition.
        return record.get("legacyChaincodeFingerprint", record["manifest"]["chaincode"])

    def admit_hybrid_release(self, record, state):
        if self.fresh:
            return self.admit_fresh_release(record, state)
        if not any(policy.HYBRID_MIGRATION.match(name) for name in record["manifest"]["migrations"]):
            return
        acknowledgement = self.config.get("hybrid_release_ack", {})
        manifest_digest = policy.sha256(json.dumps(record["manifest"], sort_keys=True, separators=(",", ":")).encode())
        require(acknowledgement.get("sha") == record["sha"] and acknowledgement.get("manifest_sha256") == manifest_digest,
                "Hybrid release requires an installed exact manifest acknowledgement")
        require(acknowledgement.get("legacy_fingerprint") == state["chaincode"]["fingerprint"],
                "Hybrid release cannot replace the legacy chaincode fingerprint")
        require(policy.DIGEST.fullmatch(acknowledgement.get("mapping_digest", "")) is not None and
                acknowledgement.get("legacy_descriptor_sha256") == self.environment.get("LEGACY_LEDGER_DESCRIPTOR_SHA256"),
                "Hybrid release requires reviewed permission mapping and independently pinned legacy descriptor")
        hosted = self.config.get("hosted", {})
        require(hosted.get("network") and hosted.get("channel") and hosted.get("network") != self.fabric.get("network") and
                hosted.get("channel") != self.fabric.get("channel"), "Hosted and legacy networks/channels must remain separate")
        require(set(hosted.get("containers", [])).isdisjoint(self.fabric.get("containers", [])) and
                set(hosted.get("volumes", [])).isdisjoint(self.fabric.get("volumes", [])), "Hosted must use independent containers and ledger volumes")
        descriptor = Path(record["directory"]) / "blockchain/chaincode/dist/governance.json"
        require(descriptor.is_file(), "Packaged hosted governance descriptor is missing")
        governance = json.loads(descriptor.read_text())
        governance_digest = policy.sha256(json.dumps(governance, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
        require(governance_digest == hosted.get("governance_digest"), "Hosted governance differs from the reviewed descriptor")
        require(hosted["channel"] in governance.get("channels", {}), "Hosted channel has no packaged governance authority")
        require(bool(hosted.get("containers")) and bool(hosted.get("volumes")) and
                set(hosted.get("images", {})) == set(hosted["containers"]), "Hosted resource/image catalog is incomplete")
        require(bool(hosted.get("backup_paths")) and all(Path(p).is_absolute() and str(Path(p)) != "/" and ".." not in Path(p).parts
                for p in hosted["backup_paths"]), "Hosted private identity/config backup catalog is missing")
        for name, image in hosted["images"].items():
            require(name in hosted["containers"] and isinstance(image, str) and re.fullmatch(r"[^\s]+@sha256:[a-f0-9]{64}", image),
                    "Hosted images must be pinned to immutable digests")
            actual = json.loads(self.run("hosted-image-identity", ["docker", "inspect", name]))[0]
            require(actual["Config"]["Image"] == image and actual["State"].get("Running"), "Hosted resource image/readiness mismatch")
        record["legacyChaincodeFingerprint"] = state["chaincode"]["fingerprint"]

    def admit_fresh_release(self, record, state):
        require("docker-compose.app-hybrid.yml" in record["manifest"]["files"], "Hosted overlay is missing")
        if state["current"] is None:
            ack = self.config.get("fresh_release_ack", {})
            digest = policy.sha256(json.dumps(record["manifest"], sort_keys=True, separators=(",", ":")).encode())
            require(ack.get("protocol") == "agritrace-fresh-install/1" and ack.get("sha") == record["sha"] and
                    ack.get("manifest_sha256") == digest, "Fresh installation requires exact manifest acknowledgement")
        descriptor = Path(record["directory"]) / "blockchain/chaincode/dist/governance.json"
        require(descriptor.is_file(), "Hosted governance descriptor is missing")
        governance = json.loads(descriptor.read_text())
        digest = policy.sha256(json.dumps(governance, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
        require(digest == self.fabric.get("governance_digest") and self.fabric["channel"] in governance.get("channels", {}), "Hosted governance differs from installed network")
        require(record["manifest"]["chaincode"] == self.fabric.get("chaincode_fingerprint"), "Hosted chaincode source differs; use a separately reviewed hosted lifecycle")
        require(set(self.fabric.get("images", {})) == set(self.fabric["containers"]), "Hosted image catalog is incomplete")
        for name, image in self.fabric["images"].items():
            require(isinstance(image, str) and re.fullmatch(r"[^\s]+@sha256:[a-f0-9]{64}", image), "Hosted images must be immutable")
            actual = json.loads(self.run("hosted-image-identity", ["docker", "inspect", name]))[0]
            require(actual["Config"]["Image"] == image and actual["State"].get("Running"), "Hosted image/readiness mismatch")
            if name.endswith(("-cc-org1", "-cc-org2", "-cc-org3")):
                require(actual["Config"].get("Labels", {}).get("agritrace.chaincode-fingerprint") == record["manifest"]["chaincode"], "Hosted executable source fingerprint differs")

    def verify(self, record, canary=None):
        if self.fresh:
            return self.verify_hosted(record, bool(canary))
        self.write_release_environment(record)
        values = policy.read_env(self.storage / "records" / record["id"] / "origin.env")
        payload = {"origin": self.origin_for(record), "corsOrigins": values["CORS_ORIGINS"].split(","),
                   "accounts": json.loads(Path(self.config["accounts"]).read_text()), "canary": canary,
                   "requireSessionFamily": bool(canary) or record.get("sessionContract") == "family-v1",
                   "legacyQrLotIds": record.get("legacyQrLotIds", [])}
        if self.target:
            payload.update(profile="fabric", canaryCatalog=self.config["smoke"] if self.fresh else self.config["canary"], environment=self.config["environment"])
        script = (Path(__file__).with_name("session-auth.mjs").read_text() + "\n" +
                  Path(__file__).with_name("verify.mjs").read_text())
        output = self.run("release-verification", self.dc(record, "exec", "-T", "worker", "node", "--input-type=module", "-e", script),
                          json.dumps(payload).encode(), timeout=480)
        result = json.loads(output)
        require(result.get("result") == "passed", "Release verification did not succeed")
        return result

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
        with (directory / "postgres.dump").open("wb") as output:
            os.chmod(output.name, 0o600)
            self.run("postgres-consistent-backup", self.dc(old, "exec", "-T", "postgres", "pg_dump", "--format=custom", "--no-owner", "--no-acl",
                     "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"]), output=output)
        stopped = False
        try:
            if self.fabric:
                stopped = True
                hosted = {} if self.fresh else self.config.get("hosted", {})
                containers = self.fabric["containers"] + hosted.get("containers", [])
                volumes = self.fabric["volumes"] + hosted.get("volumes", [])
                require(len(containers) == len(set(containers)) and len(volumes) == len(set(volumes)), "Hosted/legacy backup resources overlap")
                self.run("fabric-stop-for-snapshot", ["docker", "stop", "--time", "20", *containers], timeout=180)
                for volume in volumes:
                    mount = self.run("ledger-volume-path", ["docker", "volume", "inspect", "--format", "{{.Mountpoint}}", volume]).decode().strip()
                    require(mount == f"/var/lib/docker/volumes/{volume}/_data", "Unexpected ledger volume path")
                self.run("ledger-consistent-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "fabric-ledger.tar.gz"),
                         "-C", "/var/lib/docker/volumes", *[f"{volume}/_data" for volume in volumes]])
                self.run("private-identity-backup", ["tar", "--numeric-owner", "--acls", "--xattrs", "-czf", str(directory / "fabric-identities.tar.gz"),
                         "-C", "/", *[str(Path(p).relative_to("/")) for p in self.fabric["backup_paths"] + hosted.get("backup_paths", [])]])
                files += ["fabric-ledger.tar.gz", "fabric-identities.tar.gz"]
            private_paths = [str(Path(self.config["env"]).relative_to("/")), str(Path(self.config["accounts"]).relative_to("/"))]
            if self.fresh:
                private_paths = [str((self.base / "shared").relative_to("/")), str(self.storage.relative_to("/")),
                                 "etc/agri-trace-cd/prod", "usr/local/lib/agri-trace-cd/prod"]
            self.run("private-config-backup", ["tar", "--exclude=operations.log", "--exclude=delivery.lock", "-czf", str(directory / "private-config.tar.gz"), "-C", "/", *private_paths])
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
        containers = self.fabric["containers"] + (self.config.get("hosted", {}).get("containers", []) if not self.fresh else []) if self.target else FABRIC
        self.run("fabric-resume", ["docker", "start", *containers], timeout=180)
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
        if known["fingerprint"] != self.legacy_fingerprint(previous):
            known = previous.get("chaincode")
            require(known is not None and known["fingerprint"] == self.legacy_fingerprint(previous),
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
        atomic_json(self.storage / "state.json", state)

    @staticmethod
    def preserve(before, after):
        require(all(after["fingerprints"].get(key) == value for key, value in before["fingerprints"].items()), "Existing event/proof history changed")
        for table, count in before["counts"].items():
            require(after["counts"].get(table, -1) >= count, "Existing data count decreased")

    def quiescent_baseline(self, record, observed):
        # Authentication/readiness probes ran before stop. Capture immutable
        # business rows again from PostgreSQL after both writers have stopped;
        # the snapshot and preservation gate must share this frozen baseline.
        query = '''SELECT json_build_object('events', COALESCE((SELECT json_agg(row_to_json(x)) FROM
          (SELECT e.event_id,to_jsonb(e)::text AS immutable_row,p.tx_id,p.data_hash AS proof_hash,p.channel_id
           FROM trace_event e LEFT JOIN blockchain_proof p USING(event_id) ORDER BY e.event_id) x),'[]'::json),
          'counts', json_build_object('app_user',(SELECT count(*) FROM app_user),
          'organization',(SELECT count(*) FROM organization),'farm',(SELECT count(*) FROM farm),
          'plot',(SELECT count(*) FROM plot),'product',(SELECT count(*) FROM product),
          'production_cycle',(SELECT count(*) FROM production_cycle),'harvest_event',(SELECT count(*) FROM harvest_event),
          'lot',(SELECT count(*) FROM lot),'shipment',(SELECT count(*) FROM shipment),
          'trace_event',(SELECT count(*) FROM trace_event),'blockchain_outbox',(SELECT count(*) FROM blockchain_outbox),
          'blockchain_proof',(SELECT count(*) FROM blockchain_proof)))'''
        output = self.run("quiescent-baseline", self.dc(record, "exec", "-T", "postgres", "psql", "-U", self.environment["POSTGRES_USER"],
                          "-d", self.environment["POSTGRES_DB"], "-v", "ON_ERROR_STOP=1", "-At", "-c", query))
        values = json.loads(output)
        fingerprints = {}
        for event in values["events"]:
            fingerprints["event:" + event["event_id"]] = policy.sha256(event["immutable_row"].encode())
            if event["tx_id"]:
                proof = [event["tx_id"], event["proof_hash"], event["channel_id"]]
                fingerprints["proof:" + event["event_id"]] = policy.sha256(json.dumps(proof, separators=(",", ":"), ensure_ascii=False).encode())
        frozen = dict(observed, fingerprints=fingerprints, counts=values["counts"], writersStopped=True)
        self.preserve(observed, frozen)
        return frozen

    def rollback_to(self, target, state, before=None):
        current = self.record(state["current"])
        target_record = self.record(target)
        self.migration_policy(self.applied(current), target_record, state.get("compatible_migrations", []))
        # Code rollback across a different chaincode requires its historical package.
        chaincode = state["chaincode"]
        if self.legacy_fingerprint(target_record) != chaincode["fingerprint"]:
            old_chaincode = target_record.get("chaincode")
            require(old_chaincode is not None, "Historical chaincode package metadata is missing")
            actual = self.definition()
            chaincode = self.lifecycle(old_chaincode["packages"], f"rollback-{target_record['sha'][:12]}-{actual['sequence'] + 1}", actual["sequence"] + 1)
            chaincode["fingerprint"] = self.legacy_fingerprint(target_record)
        self.start(target_record)
        evidence = self.verify(target_record)
        if before:
            self.preserve(before, evidence)
        updated = dict(state, current=target, previous=state["current"], chaincode=chaincode)
        self.switch(target_record, updated)
        return updated, evidence


    def rollout(self, candidate, state, expected_sequence=None):
        old = self.record(state["current"])
        # Only an administrator's reviewed cutover may establish this catalog.
        # A routine release must not widen the legacy sensor exception.
        candidate["legacyQrLotIds"] = list(old.get("legacyQrLotIds", []))
        require(not (self.storage / "journal.json").exists(), "Interrupted deployment needs recover before a new rollout")
        self.preflight(candidate)
        self.admit_hybrid_release(candidate, state)
        if expected_sequence is None:
            require(self.legacy_fingerprint(candidate) == state["chaincode"]["fingerprint"], "Chaincode changed; dispatch upgrade with expected sequence")
        else:
            require(not any(policy.HYBRID_MIGRATION.match(name) for name in candidate["manifest"]["migrations"]),
                    "Hybrid source must never upgrade the retained legacy channel")
        new_migrations = self.migration_policy(self.applied(old), candidate)
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
            self.protect_hybrid_schema(candidate)
            self.migrate(candidate)
            if expected_sequence is not None:
                self.journal(old, candidate, "chaincode")
                chaincode = self.upgrade(candidate, expected_sequence)
                chaincode["fingerprint"] = candidate["manifest"]["chaincode"]
            self.journal(old, candidate, "application")
            self.start(candidate)
            self.smoke_writes = self.fresh
            try:
                if self.fresh:
                    self.start(candidate)
                evidence = self.verify(candidate, candidate["sha"])
            finally:
                self.smoke_writes = False
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
            (self.storage / "journal.json").unlink()
            if self.fresh:
                self.start(candidate)
            return {"result": "passed", "release": candidate["id"], "counts": evidence["counts"], "chaincodeSequence": chaincode["sequence"]}
        except Exception as error:
            failed_phase = self.phase
            try:
                with self.stop_on_failure(old):
                    self.stop(candidate)
                    self.resume_fabric()
                    compatible = self.recovery_migrations(old, candidate, state)
                    restored = self.restore_definition(state, old)
                    self.start(old)
                    evidence = self.verify(old)
                    self.preserve(before, evidence)
                    # Expanded schema stays; compatible migration names remain known for recovery.
                    restored_state = dict(state, chaincode=restored, compatible_migrations=compatible)
                    self.switch(old, restored_state)
                    (self.storage / "journal.json").unlink()
                    if self.fresh:
                        self.start(old)
                rollback = "verified"
            except Exception:
                rollback = "recovery-required"
            atomic_json(self.storage / "last-result.json", {"result": "failed", "sha": candidate["sha"], "phase": failed_phase, "rollback": rollback, "snapshot": snapshot})
            raise PolicyError(f"Release failed at {failed_phase}; rollback={rollback}; database and ledger were not restored") from error

    def recovery_migrations(self, previous, candidate, state):
        applied = self.applied(previous)
        additions = sorted(set(applied) - set(previous["manifest"]["migrations"]))
        compatible = set(state.get("compatible_migrations", []))
        self.migration_policy(applied, candidate, compatible)
        self.migration_policy(applied, previous, compatible | set(additions))
        for name in additions:
            if name in compatible:
                continue
            script = (Path(candidate["directory"]) / "apps/api/prisma/migrations" / name / "migration.sql").read_bytes()
            require(policy.sha256(script) == candidate["manifest"]["migrations"].get(name), "Unexpected migration after interrupted deploy")
            policy.additive_sql(script.decode("utf-8"))
        return sorted(compatible | set(additions))

    def forward(self, candidate, state):
        """Explicit reviewed application fix-forward; never restores PG/ledger.

        Incoming transport, immutable image and exact-main CI gates run first.
        The installed approval pins the candidate and manifest. A new repair
        migration still requires its own checksum review. Existing journal,
        baseline, attempts and the migration floor survive every failure.
        """
        filename = self.storage / "journal.json"
        require(filename.exists(), "Fix-forward requires an interrupted deployment journal")
        journal = json.loads(filename.read_text())
        approval = self.config.get("forward_recovery", {})
        manifest_digest = policy.sha256(json.dumps(candidate["manifest"], sort_keys=True, separators=(",", ":")).encode())
        require(approval.get("sha") == candidate["sha"] and approval.get("manifest_sha256") == manifest_digest,
                "Fix-forward candidate requires an installed exact manifest approval")
        require(journal.get("baseline") and journal.get("previous"), "Fix-forward requires a preserved cutover baseline")
        previous = self.record(journal["previous"])
        interrupted = self.record(journal["candidate"])
        self.preflight(candidate)
        self.admit_hybrid_release(candidate, state)
        self.migration_policy(self.applied(interrupted), candidate, state.get("compatible_migrations", []))
        candidate["legacyQrLotIds"] = list(previous.get("legacyQrLotIds", []))
        attempts = list(journal.get("forwardAttempts", []))
        attempts.append({"sha": candidate["sha"], "manifest_sha256": manifest_digest,
                         "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "stage": "started"})
        journal["forwardAttempts"] = attempts
        atomic_json(filename, journal)
        with self.stop_on_failure(candidate):
            self.stop(interrupted)
            self.stop(previous)
            self.resume_fabric()
            self.protect_hybrid_schema(candidate)
            self.migrate(candidate)
            # Fix-forward never changes the legacy channel/package. A hosted
            # channel lifecycle is a separately reviewed network operation.
            self.start(candidate)
            evidence = self.verify(candidate, candidate["sha"])
            self.preserve(journal["baseline"], evidence)
            candidate.update(verified=True, sessionContract="family-v1", chaincode=state["chaincode"])
            self.save_record(candidate)
            self.switch(candidate, dict(state, current=candidate["id"], previous=previous["id"]))
            attempts[-1]["stage"] = "verified"
            atomic_json(self.storage / "last-result.json", {"result": "forward-verified", "sha": candidate["sha"],
                        "release": candidate["id"], "forwardAttempts": attempts, "baseline": journal["baseline"]})
            # Archive the failure journal rather than discarding its provenance.
            atomic_json(self.storage / "records" / candidate["id"] / "recovered-journal.json", journal)
            filename.unlink()
            if self.fresh:
                self.start(candidate)
        return {"result": "forward-verified", "release": candidate["id"]}

    def recover(self):
        if not (self.storage / "journal.json").exists():
            return {"result": "no-recovery-required", "release": self.state()["current"]}
        journal = json.loads((self.storage / "journal.json").read_text())
        if self.fresh and journal.get("previous") is None:
            candidate = self.record(journal["candidate"])
            return self.first_install(candidate, self.state(), resume=True)
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
            self.start(previous)
            evidence = self.verify(previous)
            if journal.get("baseline"):
                self.preserve(journal["baseline"], evidence)
            self.switch(previous, dict(state, current=previous["id"],
                        previous=state["current"] if state["current"] != previous["id"] else state.get("previous"), chaincode=chaincode,
                        compatible_migrations=compatible))
            (self.storage / "journal.json").unlink()
            if self.fresh:
                self.start(previous)
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
        require(state["current"] is not None or (self.fresh and op == "deploy"), "Production requires an adopted verified release")
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
                self.migration_policy(self.applied(old), record, state.get("compatible_migrations", []))
                self.journal(old, record, "rollback", before)
                try:
                    with self.stop_on_failure(record):
                        self.stop(old)
                        before = self.quiescent_baseline(old, before)
                        self.journal(old, record, "rollback", before)
                        self.snapshot(old, parts[1], before)
                        _, evidence = self.rollback_to(target, state, before)
                        (self.storage / "journal.json").unlink()
                        if self.fresh:
                            self.start(self.record(target))
                    return {"result": "rolled-back", "release": target, "counts": evidence["counts"]}
                except Exception:
                    # Journal preserves an explicit recover path; no implicit data restore.
                    raise PolicyError("Rollback did not complete; run recover to restore the previous verified application")
            return {"result": "unchanged", "release": target}
        # This must precede transport/record writes and the same-SHA fast path.
        if op != "forward":
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
                if self.fresh or self.config.get("hybrid_open_ack", {}).get("sha") == record["sha"]:
                    self.preflight(record)
                    self.admit_hybrid_release(record, state)
                    self.migration_policy(self.applied(record), record, state.get("compatible_migrations", []))
                    self.start(record)
                evidence = self.verify(record)
                return {"result": "unchanged", "release": release, "counts": evidence["counts"]}
            self.registry(record, auth)
            if self.fresh and state["current"] is None:
                return self.first_install(record, state)
            if op == "forward":
                return self.forward(record, state)
            return self.rollout(record, state, int(parts[3]) if op == "upgrade" else None)

    def first_install(self, candidate, state, resume=False):
        require(self.fresh and (state["current"] is None or (resume and state["current"] == candidate["id"] and candidate.get("verified"))),
                "Initial installation requires a fresh uninitialized target or its interrupted promotion")
        filename = self.storage / "journal.json"
        if resume:
            journal = json.loads(filename.read_text())
            require(journal.get("previous") is None and journal.get("candidate") == candidate["id"], "Initial recovery candidate differs")
        else:
            require(not filename.exists(), "Initial installation needs recovery before retry")
            journal = {"previous": None, "candidate": candidate["id"], "stage": "fresh-database", "emptyDatabaseVerified": False}
        self.preflight(candidate)
        self.admit_fresh_release(candidate, state)
        self.register_fresh_backup(candidate)
        if not resume:
            self.migration_policy({}, candidate)
        atomic_json(filename, journal)
        with self.stop_on_failure(candidate):
            if resume:
                self.stop(candidate)
            self.run("fresh-postgres-readiness", self.dc(candidate, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "postgres"), timeout=240)
            if not journal.get("emptyDatabaseVerified"):
                query = "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public'"
                count = self.run("fresh-empty-database", self.dc(candidate, "exec", "-T", "postgres", "psql", "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"], "-At", "-c", query)).decode().strip()
                require(count == "0", "First installation refuses an existing schema; no database is reset")
                journal["emptyDatabaseVerified"] = True
                journal["stage"] = "fresh-migration"
                atomic_json(filename, journal)
            if resume:
                query = "SELECT to_regclass('public._prisma_migrations') IS NOT NULL"
                exists = self.run("fresh-migration-table", self.dc(candidate, "exec", "-T", "postgres", "psql", "-U", self.environment["POSTGRES_USER"], "-d", self.environment["POSTGRES_DB"], "-At", "-c", query)).decode().strip()
                self.migration_policy(self.applied(candidate) if exists == "t" else {}, candidate)
            self.protect_hybrid_schema(candidate)
            self.migrate(candidate)
            journal["stage"] = "fresh-bootstrap"
            atomic_json(filename, journal)
            self.bootstrap_hosted(candidate)
            self.start(candidate)
            journal["stage"] = "fresh-smoke"
            atomic_json(filename, journal)
            self.smoke_writes = True
            try:
                self.start(candidate)
                evidence = self.verify(candidate, candidate["sha"])
            finally:
                self.smoke_writes = False
            definition = self.definition()
            definition["fingerprint"] = candidate["manifest"]["chaincode"]
            candidate.update(verified=True, sessionContract="family-v1", chaincode=definition)
            self.save_record(candidate)
            self.switch(candidate, dict(state, current=candidate["id"], previous=None, chaincode=definition))
            atomic_json(self.storage / "last-result.json", {"result": "fresh-installed", "sha": candidate["sha"], "smoke": evidence})
            journal["stage"] = "verified"
            atomic_json(filename, journal)
            self.smoke_writes = self.config.get("open_after_smoke") is True or self.config.get("writes_mode") == "OPEN"
            try:
                self.start(candidate)
            finally:
                self.smoke_writes = False
            atomic_json(self.storage / "records" / candidate["id"] / "installation-journal.json", journal)
            filename.unlink()
        return {"result": "fresh-installed", "release": candidate["id"], "counts": evidence["counts"]}

    def register_fresh_backup(self, candidate):
        evidence = json.loads(Path(self.config["restore_evidence"]).read_text())
        archive = Path(evidence["encrypted_archive"])
        require(evidence.get("result") == "passed" and evidence.get("off_vps") is True and
                policy.targets.owned_path(archive, self.base / "backups") and archive.is_file() and
                policy.sha256(archive.read_bytes()) == evidence["archive_sha256"], "First deployment needs its verified recovery archive")
        filename = self.storage / "backups.json"
        catalog = json.loads(filename.read_text()) if filename.exists() else {}
        catalog[candidate["sha"]] = str(archive.parent)
        atomic_json(filename, catalog)

    def bootstrap_hosted(self, record, key_refs=None):
        filename = self.config.get("bootstrap")
        require(filename and policy.targets.owned_path(filename, self.base / "shared"), "Hosted bootstrap configuration is missing")
        payload = json.loads(Path(filename).read_text())
        payload["accounts"] = json.loads(Path(self.config["accounts"]).read_text())
        if key_refs is not None:
            payload.update(operation="activate-keys", keyRefs=key_refs)
        return self.hosted_operator(record, payload, ["node", "apps/api/scripts/bootstrap-production.mjs"], "hosted-production-bootstrap")

    def hosted_operator(self, record, payload, program, label, smoke_directory=None):
        image = record["manifest"]["api"]
        # Owner approval identities belong to this one-off operator, never the
        # API or persistent Worker. Configuration and credentials use stdin.
        metadata = json.loads(self.run("bootstrap-database-target", ["docker", "inspect", self.project + "-postgres-1"]))[0]
        require(metadata["Config"]["Labels"].get("com.docker.compose.project") == self.project, "Bootstrap database ownership differs")
        address = metadata["NetworkSettings"]["Networks"][self.project + "_default"]["IPAddress"]
        require(re.fullmatch(r"[0-9.]{7,15}", address), "Bootstrap database address is invalid")
        command = ["docker", "run", "--rm", "-i", "--user", "0:0", "--network", "host", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                   "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--mount", f"type=bind,src={self.fabric['root']},dst=/operator,readonly",
                   "--mount", f"type=bind,src={self.environment['FABRIC_BINDINGS_CONFIG_HOST']},dst=/worker-bindings.json",
                   "--memory", "384m", "--cpus", "0.5", "--env", "APP_ENV=production", "--env", "PRODUCTION_BOOTSTRAP_ENABLED=true"]
        if smoke_directory:
            command += ["--mount", f"type=bind,src={smoke_directory},dst=/smoke"]
        command += [image, *program]
        payload["databaseUrl"] = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@{address}:5432/{self.environment['POSTGRES_DB']}?schema=public"
        return json.loads(self.run(label, command, json.dumps(payload).encode(), timeout=720))

    def verify_hosted(self, record, write=False):
        directory = self.base / "shared" / "smoke" / record["sha"]
        filename = directory / "state.json"
        if not filename.exists():
            atomic_json(filename, {"sha": record["sha"], "chainId": self.config["smoke"]["chainId"], "commands": {}, "keys": {}})
        metadata = json.loads(self.run("smoke-worker-target", ["docker", "inspect", self.project + "-worker-1"]))[0]
        require(metadata["Config"]["Labels"].get("com.docker.compose.project") == self.project, "Smoke Worker ownership differs")
        address = metadata["NetworkSettings"]["Networks"][self.project + "_default"]["IPAddress"]
        require(re.fullmatch(r"[0-9.]{7,15}", address), "Smoke Worker address is invalid")
        bootstrap = json.loads(Path(self.config["bootstrap"]).read_text())
        payload = {"environment": "production", "sha": record["sha"], "origin": self.origin_for(record), "catalog": self.config["smoke"],
                   "accounts": json.loads(Path(self.config["accounts"]).read_text()), "corsOrigins": self.environment["CORS_ORIGINS"].split(","),
                   "channel": self.fabric["channel"], "channels": list(self.fabric["channels"]), "chaincode": self.fabric["chaincode"], "connection": bootstrap["connections"]["relayer"],
                   "workerReadyUrl": f"http://{address}:8081/health/ready"}
        script = Path(__file__).with_name("session-auth.mjs").read_text() + "\n" + Path(__file__).with_name("verify-hosted.mjs").read_text()
        program = ["node", "--input-type=module", "-e", script]
        if write:
            require(self.fresh_write_mode(record) == "OPEN", "Business smoke requires an explicitly opened deployment session")
            enrolled = self.hosted_operator(record, dict(payload, stage="enroll"), program, "smoke-key-enrollment", directory)
            require(enrolled.get("result") == "passed", "Smoke key enrollment failed")
            self.bootstrap_hosted(record, enrolled["keyRefs"])
        result = self.hosted_operator(record, dict(payload, stage="verify" if write else "read"), program, "hosted-production-smoke", directory)
        require(result.get("result") == "passed", "Hosted production smoke failed")
        return result


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
