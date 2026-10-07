#!/usr/bin/env python3
"""Transactional UAT delivery. This installed file is root-owned, not run from a release."""
import argparse
import contextlib
import datetime
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
        require(release.startswith("uat-") and all(c.isalnum() or c in "-_." for c in release), "Unknown release")
        return json.loads((self.storage / "records" / release / "record.json").read_text())

    def save_record(self, record):
        directory = self.storage / "records" / record["id"]
        atomic_json(directory / "record.json", record)
        atomic_json(directory / "images.json", {"services": {
            name: {"image": record["manifest"]["web" if name == "web" else "api"]}
            for name in ("api", "worker", "migrate", "bootstrap", "web")}})

    def dc(self, record, *args):
        root = Path(record["directory"])
        return ["docker", "compose", "--project-name", "agri-trace-uat", "--env-file", self.config["env"],
                "-f", str(root / "docker-compose.uat.yml"), "-f", str(root / "docker-compose.uat-fabric.yml"),
                "-f", str(self.storage / "records" / record["id"] / "images.json"), *args]

    def preflight(self, record):
        require(shutil.disk_usage(self.base).free >= 12 * 1024 ** 3, "At least 12 GiB free disk is required")
        for name, digest in record["manifest"].get("controller", {}).items():
            require(policy.sha256(Path(__file__).with_name(name).read_bytes()) == digest,
                    "CD controller changed; administrator must install the reviewed version before delivery")
        model = json.loads(self.run("compose-preflight", self.dc(record, "--profile", "tools", "config", "--format", "json")))
        require(model["name"] == "agri-trace-uat", "Compose project changed")
        services = model["services"]
        require(set(services) == {"postgres", "migrate", "bootstrap", "api", "worker", "web", "proxy"}, "Unexpected Compose services")
        for name, service in services.items():
            require(len(service.get("ports", [])) == (1 if name == "proxy" else 0), "Unexpected published service port")
            require(not service.get("privileged") and not service.get("cap_add") and not service.get("devices") and
                    not service.get("network_mode") and not service.get("pid"), "Unexpected container privilege")
        require(services["postgres"]["image"] == self.environment["POSTGRES_IMAGE"] and
                services["proxy"]["image"] == self.environment["CADDY_IMAGE"], "Infrastructure image changes require separate review")
        require(services["postgres"]["volumes"][0]["source"] == "postgres-data" and
                services["postgres"]["volumes"][0]["target"] == "/var/lib/postgresql", "Database volume changed")
        port = services["proxy"]["ports"][0]
        require(str(port["published"]) == self.environment["HTTP_PORT"] and port["host_ip"] == self.environment["HTTP_BIND"], "Public binding changed")
        expected_database = f"postgresql://{self.environment['POSTGRES_USER']}:{self.environment['POSTGRES_PASSWORD']}@postgres:5432/{self.environment['POSTGRES_DB']}?schema=public"
        for name in ("api", "worker", "migrate", "bootstrap"):
            require(services[name]["environment"]["DATABASE_URL"] == expected_database, "Database configuration changed")
        for name in ("api", "web"):
            require(not services[name].get("volumes") and not services[name].get("secrets"), "Public service received host secrets")
        if record["manifest"].get("controller"):
            require(services["web"]["environment"].get("API_INTERNAL_BASE_URL") == "http://api:8080/api",
                    "Web server must use the internal API for public trace rendering")
        require(services["api"]["environment"]["FABRIC_ENABLED"] == "false" and
                services["api"]["environment"]["CORS_ORIGIN"] == self.config["origin"] and
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
        payload = {"origin": self.config["origin"], "accounts": json.loads(Path(self.config["accounts"]).read_text()), "canary": canary}
        script = Path(__file__).with_name("verify.mjs").read_text()
        output = self.run("release-verification", self.dc(record, "exec", "-T", "worker", "node", "--input-type=module", "-e", script),
                          json.dumps(payload).encode(), timeout=480)
        result = json.loads(output)
        require(result.get("result") == "passed", "Release verification did not succeed")
        return result

    def start(self, record):
        self.run("api-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "api"), timeout=240)
        self.run("worker-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "worker"), timeout=240)
        self.run("web-proxy-readiness", self.dc(record, "up", "-d", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "180", "web", "proxy"), timeout=240)

    def stop(self, record):
        self.run("stop-writers", self.dc(record, "stop", "api", "worker"), timeout=200)

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
        branch = request("git/ref/heads/main")
        runs = request(f"actions/runs?head_sha={record['sha']}&event=push&per_page=100")
        policy.ci_gate(runs["workflow_runs"], record["sha"], branch["object"]["sha"])

    def journal(self, old, candidate, stage, baseline=None):
        filename = self.storage / "journal.json"
        previous = json.loads(filename.read_text()) if filename.exists() else {}
        updated = dict(previous, previous=old["id"], candidate=candidate["id"], stage=stage)
        if baseline is not None:
            updated["baseline"] = baseline
        atomic_json(filename, updated)

    def snapshot(self, old, attempt_sha, baseline):
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
            self.run("fabric-resume", ["docker", "start", *FABRIC], timeout=180)
        return str(directory)

    def peer_env(self, org):
        samples = Path(self.config["network_root"]) / "blockchain/.fabric/fabric-samples"
        organizations = samples / "test-network/organizations"
        msp = organizations / f"peerOrganizations/org{org}.example.com/users/Admin@org{org}.example.com/msp"
        tls = organizations / f"peerOrganizations/org{org}.example.com/peers/peer0.org{org}.example.com/tls/ca.crt"
        environment = dict(os.environ, CORE_PEER_TLS_ENABLED="true", CORE_PEER_LOCALMSPID=f"Org{org}MSP", CORE_PEER_MSPCONFIGPATH=str(msp),
                           CORE_PEER_ADDRESS=f"localhost:{7051 if org == 1 else 9051}", CORE_PEER_TLS_ROOTCERT_FILE=str(tls), FABRIC_CFG_PATH=str(samples / "config"))
        return str(samples / "bin/peer"), environment

    def peer(self, label, org, *arguments):
        binary, environment = self.peer_env(org)
        return self.run(label, [binary, "lifecycle", "chaincode", *arguments], env=environment, timeout=480)

    def definition(self):
        results = [json.loads(self.peer("chaincode-query-committed", org, "querycommitted", "--channelID", "agritrace", "--name", "agritrace", "--output", "json")) for org in (1, 2)]
        require(results[0] == results[1], "Peers disagree on the committed chaincode definition")
        require(results[0].get("endorsement_plugin") == "escc" and results[0].get("validation_plugin") == "vscc" and
                results[0].get("validation_parameter") == "EiAvQ2hhbm5lbC9BcHBsaWNhdGlvbi9FbmRvcnNlbWVudA==" and
                not results[0].get("collections"), "Custom Fabric policy/collections need separate reviewed lifecycle support")
        return results[0]

    def lifecycle(self, package_ids, version, sequence):
        samples = Path(self.config["network_root"]) / "blockchain/.fabric/fabric-samples/test-network/organizations"
        orderer_ca = samples / "ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt"
        orderer = ["-o", "localhost:7050", "--ordererTLSHostnameOverride", "orderer.example.com", "--tls", "--cafile", str(orderer_ca)]
        definition = ["--channelID", "agritrace", "--name", "agritrace", "--version", version, "--sequence", str(sequence)]
        for org in (1, 2):
            self.peer("chaincode-approve", org, "approveformyorg", *orderer, *definition, "--package-id", package_ids[str(org)], "--waitForEvent", "--waitForEventTimeout", "60s")
        ready = json.loads(self.peer("chaincode-commit-readiness", 1, "checkcommitreadiness", *definition, "--output", "json"))
        require(ready.get("approvals", {}).get("Org1MSP") and ready.get("approvals", {}).get("Org2MSP"), "Both organizations must approve the definition")
        peers = []
        for org, port in ((1, 7051), (2, 9051)):
            tls = samples / f"peerOrganizations/org{org}.example.com/peers/peer0.org{org}.example.com/tls/ca.crt"
            peers += ["--peerAddresses", f"localhost:{port}", "--tlsRootCertFiles", str(tls)]
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
        self.start(target_record)
        evidence = self.verify(target_record)
        if before:
            self.preserve(before, evidence)
        updated = dict(state, current=target, previous=state["current"], chaincode=chaincode)
        self.switch(target_record, updated)
        return updated, evidence

    def rollout(self, candidate, state, expected_sequence=None):
        old = self.record(state["current"])
        require(not (self.storage / "journal.json").exists(), "Interrupted deployment needs recover before a new rollout")
        self.preflight(candidate)
        new_migrations = policy.migrations(self.applied(old), candidate["manifest"]["migrations"], candidate["directory"])
        if expected_sequence is None:
            require(candidate["manifest"]["chaincode"] == state["chaincode"]["fingerprint"], "Chaincode changed; dispatch upgrade with expected sequence")
        else:
            require(self.definition()["sequence"] == expected_sequence, "Expected chaincode sequence mismatch")
        before = self.verify(old)
        self.journal(old, candidate, "snapshot", before)
        chaincode = state["chaincode"]
        snapshot = None
        try:
            self.stop(old)
            snapshot = self.snapshot(old, candidate["sha"], before)
            self.journal(old, candidate, "migration")
            self.migrate(candidate)
            if expected_sequence is not None:
                self.journal(old, candidate, "chaincode")
                chaincode = self.upgrade(candidate, expected_sequence)
                chaincode["fingerprint"] = candidate["manifest"]["chaincode"]
            self.journal(old, candidate, "application")
            self.start(candidate)
            evidence = self.verify(candidate, candidate["sha"])
            self.preserve(before, evidence)
            candidate["verified"] = True
            candidate["chaincode"] = chaincode
            self.save_record(candidate)
            updated = dict(state, current=candidate["id"], previous=old["id"] if old["id"] != candidate["id"] else state.get("previous"),
                           chaincode=chaincode, compatible_migrations=sorted(set(state.get("compatible_migrations", [])) | set(new_migrations)))
            self.switch(candidate, updated)
            (self.storage / "journal.json").unlink()
            atomic_json(self.storage / "last-result.json", {"result": "passed", "sha": candidate["sha"], "release": candidate["id"], "snapshot": snapshot,
                       "counts": evidence["counts"], "canary": evidence["canary"], "chaincode": chaincode})
            return {"result": "passed", "release": candidate["id"], "counts": evidence["counts"], "chaincodeSequence": chaincode["sequence"]}
        except Exception as error:
            failed_phase = self.phase
            try:
                self.stop(candidate)
                restored = self.restore_definition(state, old)
                self.start(old)
                evidence = self.verify(old)
                self.preserve(before, evidence)
                # Expanded schema stays; compatible migration names remain known for recovery.
                restored_state = dict(state, chaincode=restored, compatible_migrations=sorted(set(state.get("compatible_migrations", [])) | set(new_migrations)))
                self.switch(old, restored_state)
                (self.storage / "journal.json").unlink()
                rollback = "verified"
            except Exception:
                rollback = "recovery-required"
            atomic_json(self.storage / "last-result.json", {"result": "failed", "sha": candidate["sha"], "phase": failed_phase, "rollback": rollback, "snapshot": snapshot})
            raise PolicyError(f"Release failed at {failed_phase}; rollback={rollback}; database and ledger were not restored") from error

    def recover(self):
        if not (self.storage / "journal.json").exists():
            return {"result": "no-recovery-required", "release": self.state()["current"]}
        journal = json.loads((self.storage / "journal.json").read_text())
        state = self.state()
        previous = self.record(journal["previous"])
        candidate = self.record(journal["candidate"])
        self.stop(candidate)
        chaincode = self.restore_definition(state, previous)
        self.start(previous)
        evidence = self.verify(previous)
        if journal.get("baseline"):
            self.preserve(journal["baseline"], evidence)
        # A completed migration from an interrupted release still requires compatibility validation.
        applied = self.applied(previous)
        additions = sorted(set(applied) - set(previous["manifest"]["migrations"]))
        for name in additions:
            require(candidate["manifest"]["migrations"].get(name) == applied[name], "Unexpected migration after interrupted deploy")
            policy.additive_sql((Path(candidate["directory"]) / "apps/api/prisma/migrations" / name / "migration.sql").read_text())
        self.switch(previous, dict(state, current=previous["id"],
                    previous=state["current"] if state["current"] != previous["id"] else state.get("previous"), chaincode=chaincode,
                    compatible_migrations=sorted(set(state.get("compatible_migrations", [])) | set(additions))))
        (self.storage / "journal.json").unlink()
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
        state = self.state()
        if op == "rollback":
            require(not (self.storage / "journal.json").exists(), "Recover interrupted rollout before rollback")
            target = "uat-" + parts[1]
            if target != state["current"]:
                record = self.record(target)
                require(record.get("verified"), "Rollback target was not verified")
                old = self.record(state["current"])
                before = self.verify(old)
                # Validate compatibility before stopping any service.
                policy.migrations(self.applied(old), record["manifest"]["migrations"], record["directory"], state.get("compatible_migrations", []))
                self.journal(old, record, "rollback", before)
                try:
                    self.stop(old)
                    self.snapshot(old, parts[1], before)
                    _, evidence = self.rollback_to(target, state, before)
                    (self.storage / "journal.json").unlink()
                    return {"result": "rolled-back", "release": target, "counts": evidence["counts"]}
                except Exception:
                    # Journal preserves an explicit recover path; no implicit data restore.
                    raise PolicyError("Rollback did not complete; run recover to restore the previous verified application")
            return {"result": "unchanged", "release": target}
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
            release = "uat-" + parts[1]
            destination = Path(temporary) / "validated"
            manifest = policy.extract(archive, destination, parts[1], self.config["repository"], self.config["origin"])
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
            if state["current"] == release and op == "deploy":
                evidence = self.verify(record)
                return {"result": "unchanged", "release": release, "counts": evidence["counts"]}
            self.registry(record, auth)
            self.server_gate(record, auth)
            return self.rollout(record, state, int(parts[3]) if op == "upgrade" else None)


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
