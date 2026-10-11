#!/usr/bin/env python3
"""Administrator provisioning for the retained, isolated development Fabric.

Uses pinned upstream CA/channel scripts, never test-network/network.sh or its
host-wide teardown. Activation stays with install-target.py fabric-on/off.
"""
import argparse
import contextlib
import hashlib
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "cd"))
from install import administrator_lock
from controller import Controller, atomic_json, policy

ROOT = Path("/opt/agri-trace-dev/shared/fabric")
CONFIG = Path("/etc/agri-trace-cd/dev/config.json")
SAMPLES = "5789681b4f4d24e58fa40f19a69f5496892374b6"
ASSETS = {
    "fabric": ("2.5.16", "18c91e7f2f11b601e6622cc70454d568af897707ee9adf111e9fa91a233881bf"),
    "fabric-ca": ("1.5.22", "7f52ab98481ac0e4bfcf5b5aabfb403fa692ee100ae3b2ca3bf3f2152851573d"),
}
HOSTS = {"orderer.example.com": "agritrace-dev-orderer",
         "peer0.org1.example.com": "agritrace-dev-peer1", "peer0.org2.example.com": "agritrace-dev-peer2",
         "ca_org1": "agritrace-dev-ca1", "ca_org2": "agritrace-dev-ca2", "ca_orderer": "agritrace-dev-ca-orderer"}
PORTS = {p: p + 20000 for p in (7050, 7051, 7052, 7053, 7054, 8054, 9051, 9052, 9054, 9443, 9444, 9445, 17054, 18054, 19054)}
FILES = ("configtx/configtx.yaml", "scripts/utils.sh", "scripts/envVar.sh", "scripts/orderer.sh",
         "scripts/setAnchorPeer.sh", "scripts/configUpdate.sh", "scripts/createChannel.sh", "organizations/fabric-ca/registerEnroll.sh",
         "compose/compose-ca.yaml", "compose/compose-test-net.yaml", "compose/docker/docker-compose-test-net.yaml",
         "compose/docker/peercfg/core.yaml")


def transform(text, credentials):
    for old, new in HOSTS.items():
        text = text.replace(old, new)
    text = text.replace("peer0.org${ORG}.example.com", "agritrace-dev-peer${ORG}")
    text = text.replace("example.com", "agritrace-dev.local").replace("fabric_test", "agritrace-dev-fabric")
    text = re.sub(r"(?<![0-9])(?:" + "|".join(map(str, PORTS)) + r")(?![0-9])",
                  lambda m: str(PORTS[int(m[0])]), text)
    text = re.sub(r"hyperledger/(fabric-(?:peer|orderer|ca)):latest",
                  lambda m: "hyperledger/" + m[1] + (":1.5.22" if m[1] == "fabric-ca" else ":2.5.16"), text)
    for old, value in credentials.items():
        text = text.replace(old, value)
    return text


def validate_model(model):
    policy.require(set(model["services"]) == set(HOSTS.values()), "Unexpected dev Fabric services")
    policy.require(model["networks"]["test"]["name"] == "agritrace-dev-fabric", "Cross-environment network")
    policy.require({v["name"] for v in model["volumes"].values()} ==
                   {"agritrace-dev-ledger-orderer", "agritrace-dev-ledger-peer1", "agritrace-dev-ledger-peer2"}, "Unowned ledger volumes")
    ports = []
    for name, service in model["services"].items():
        policy.require(service["container_name"] == name and set(service["networks"]) == {"test"}, "Unexpected service binding")
        policy.require(service["image"] in {"hyperledger/fabric-peer:2.5.16", "hyperledger/fabric-orderer:2.5.16", "hyperledger/fabric-ca:1.5.22"}, "Unpinned image")
        policy.require(0 < service.get("mem_limit", 0) <= 512 * 1048576 and 0 < service.get("cpus", 0) <= 1, "Missing resource limit")
        for port in service.get("ports", []):
            policy.require(port["host_ip"] == "127.0.0.1" and int(port["published"]) in PORTS.values(), "Public or conflicting host binding")
            ports.append(int(port["published"]))
        for mount in service.get("volumes", []):
            if mount["type"] == "bind" and mount["source"] != "/var/run/docker.sock":
                policy.require(Path(mount["source"]).resolve().is_relative_to(ROOT.resolve()), "Cross-environment mount")
            elif mount["type"] == "volume":
                policy.require(mount["source"] in model["volumes"], "Uncatalogued ledger")
        if "fabric-peer" in service["image"]:
            env = service["environment"]
            policy.require(env["CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE"] == "agritrace-dev-fabric" and
                           env["CORE_VM_DOCKER_HOSTCONFIG_MEMORY"] == "536870912", "Unbounded or unowned chaincode runtime")
    policy.require(len(ports) == 13 and len(set(ports)) == 13, "Unexpected published ports")


def absent_resources():
    for kind, names in (("container", HOSTS.values()), ("volume", ["agritrace-dev-ledger-orderer", "agritrace-dev-ledger-peer1", "agritrace-dev-ledger-peer2"]), ("network", ["agritrace-dev-fabric"])):
        for name in names:
            found = subprocess.run(["docker", kind, "inspect", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            policy.require(found.returncode != 0, "Resource already exists; review ownership before provisioning")


def safe_root():
    policy.require(ROOT.resolve() == ROOT and not ROOT.is_symlink(), "Fabric root may not resolve outside dev")
    ROOT.mkdir(parents=True, mode=0o700, exist_ok=True)
    ROOT.chmod(0o700)


def prepare(c):
    safe_root()
    marker = ROOT / "prepared.json"
    policy.require(not marker.exists() and not (ROOT / "working").exists(), "Prepared files exist; reconcile instead of overwriting identities")
    policy.require(not c.fabric and c.state()["chaincode"]["sequence"] == 0, "Existing ledger needs a retained-network recovery")
    record = c.record(c.state()["current"])
    count = c.run("dev-fabric-proof-check", c.dc(record, "exec", "-T", "postgres", "psql", "-U", c.environment["POSTGRES_USER"],
                  "-d", c.environment["POSTGRES_DB"], "-Atq", "-c", "SELECT count(*) FROM blockchain_proof")).decode().strip()
    policy.require(count == "0", "Confirmed DB proofs cannot be attached to a fresh ledger")
    absent_resources()
    source = ROOT / "pinned-samples"
    if not source.exists():
        c.run("dev-fabric-samples-clone", ["git", "clone", "--no-checkout", "https://github.com/hyperledger/fabric-samples.git", str(source)])
    c.run("dev-fabric-samples-fetch", ["git", "-C", str(source), "fetch", "--depth", "1", "origin", SAMPLES])
    c.run("dev-fabric-samples-pin", ["git", "-C", str(source), "checkout", "--detach", SAMPLES])
    policy.require(c.run("dev-fabric-samples-revision", ["git", "-C", str(source), "rev-parse", "HEAD"]).decode().strip() == SAMPLES, "Samples revision mismatch")
    working = ROOT / "working"
    working.mkdir(mode=0o700)
    for repo, (version, digest) in ASSETS.items():
        archive = ROOT / (repo + ".tar.gz")
        url = f"https://github.com/hyperledger/{repo}/releases/download/v{version}/hyperledger-{repo}-linux-amd64-{version}.tar.gz"
        with urllib.request.urlopen(url, timeout=60) as response, archive.open("wb") as output:
            shutil.copyfileobj(response, output)
        policy.require(hashlib.sha256(archive.read_bytes()).hexdigest() == digest, "Fabric binary checksum mismatch")
        with tarfile.open(archive) as tar:
            tar.extractall(working, filter="data")
    credentials = {word: secrets.token_hex(24) for word in ("adminpw", "peer0pw", "user1pw", "org1adminpw", "org2adminpw", "ordererpw", "ordererAdminpw")}
    # Longest first prevents adminpw from partially rewriting org1adminpw.
    credentials = dict(sorted(credentials.items(), key=lambda pair: -len(pair[0])))
    credentials["RELAYER"] = secrets.token_hex(24)
    network = working / "test-network"
    for name in FILES:
        target = network / name
        target.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
        target.write_text(transform((source / "test-network" / name).read_text(), credentials))
        target.chmod(0o700 if name.endswith(".sh") else 0o600)
    compose = ["docker", "compose", "-p", "agritrace-dev-fabric-runtime", "-f", str(network / "compose/compose-test-net.yaml"),
               "-f", str(network / "compose/docker/docker-compose-test-net.yaml"), "-f", str(network / "compose/compose-ca.yaml")]
    model = json.loads(c.run("dev-fabric-compose-resolve", [*compose, "config", "--format", "json"], env=dict(os.environ, DOCKER_SOCK="/var/run/docker.sock")))
    model.pop("name", None)
    for name, value in model["volumes"].items():
        value["name"] = "agritrace-dev-ledger-" + ("orderer" if name.endswith("orderer") else "peer1" if name.endswith("peer1") else "peer2")
    for name, service in model["services"].items():
        service["mem_limit"] = (512 if "peer" in name else 256 if name.endswith("orderer") and "ca-" not in name else 128) * 1048576
        service["cpus"] = 1.0
        service["restart"] = "unless-stopped"
        service["labels"]["agritrace.environment"] = "development"
        if "fabric-peer" in service["image"]:
            service["environment"].update(CORE_PEER_NETWORKID="agritrace-dev", CORE_VM_DOCKER_HOSTCONFIG_MEMORY="536870912", CORE_VM_DOCKER_HOSTCONFIG_NANOCPUS="1000000000")
    validate_model(model)
    absent_resources()
    atomic_json(ROOT / "compose.json", model)
    atomic_json(ROOT / "ca-secrets.json", credentials)
    atomic_json(marker, {"samples": SAMPLES, "binaryChecksums": {k: v[1] for k, v in ASSETS.items()},
                         "files": {name: policy.sha256((network / name).read_bytes()) for name in FILES},
                         "composeChecksum": policy.sha256((ROOT / "compose.json").read_bytes())})
    return {"result": "prepared", "samples": SAMPLES, "network": "agritrace-dev-fabric", "hostBindings": "IPv4 loopback only"}


def descriptor():
    working = ROOT / "working"
    organizations = working / "test-network/organizations"
    peers = {}
    for org in (1, 2):
        base = organizations / f"peerOrganizations/org{org}.agritrace-dev.local"
        peers[str(org)] = {"address": f"127.0.0.1:{27051 if org == 1 else 29051}", "msp_id": f"Org{org}MSP", "hostname": f"agritrace-dev-peer{org}",
                           "msp": str(base / f"users/Admin@org{org}.agritrace-dev.local/msp"),
                           "tls": str(base / f"peers/agritrace-dev-peer{org}/tls/ca.crt")}
    return {"network": "agritrace-dev-fabric", "root": str(ROOT), "channel": "agritrace-dev", "chaincode": "agritrace",
            "containers": list(HOSTS.values()), "volumes": ["agritrace-dev-ledger-orderer", "agritrace-dev-ledger-peer1", "agritrace-dev-ledger-peer2"],
            "peer_binary": str(working / "bin/peer"), "config_path": str(working / "config"), "peers": peers,
            "orderer": {"address": "127.0.0.1:27050", "hostname": "agritrace-dev-orderer",
                        "tls": str(organizations / "ordererOrganizations/agritrace-dev.local/orderers/agritrace-dev-orderer/tls/ca.crt")},
            "backup_paths": [str(working), str(ROOT / "identities"), str(ROOT / "compose.json"), str(ROOT / "ca-secrets.json"), str(ROOT / "provisioned.json")]}


def provision(c):
    safe_root()
    prepared = json.loads((ROOT / "prepared.json").read_text())
    policy.require(not c.fabric and not (ROOT / "provisioning.json").exists() and not (ROOT / "provisioned.json").exists(), "Partial/existing network requires manual reconciliation; no identity reset")
    network = ROOT / "working/test-network"
    policy.require(all(policy.sha256((network / name).read_bytes()) == checksum for name, checksum in prepared["files"].items()) and
                   policy.sha256((ROOT / "compose.json").read_bytes()) == prepared["composeChecksum"], "Prepared source changed")
    model = json.loads((ROOT / "compose.json").read_text())
    validate_model(model)
    absent_resources()
    memory = dict(row.split(":", 1) for row in Path("/proc/meminfo").read_text().splitlines())
    policy.require(int(memory["MemAvailable"].split()[0]) >= 3584 * 1024, "Insufficient host RAM")
    atomic_json(ROOT / "provisioning.json", {"release": c.state()["current"], "phase": "creating"})
    compose = ["docker", "compose", "-p", "agritrace-dev-fabric-runtime", "-f", str(ROOT / "compose.json")]
    env = dict(os.environ, PATH=str(ROOT / "working/bin") + ":" + os.environ["PATH"], FABRIC_CFG_PATH=str(ROOT / "working/config"), ROOTDIR=str(network))
    try:
        c.run("dev-fabric-ca-start", [*compose, "up", "-d", "agritrace-dev-ca1", "agritrace-dev-ca2", "agritrace-dev-ca-orderer"])
        deadline = time.monotonic() + 60
        while not all((network / "organizations/fabric-ca" / org / "tls-cert.pem").exists() for org in ("org1", "org2", "ordererOrg")):
            policy.require(time.monotonic() < deadline, "Dev CAs did not become ready")
            time.sleep(1)
        c.run("dev-fabric-org-enroll", ["bash", "-c", 'cd -- "$1"; set -e; source scripts/utils.sh; source organizations/fabric-ca/registerEnroll.sh; createOrg1; createOrg2; createOrderer', "bash", str(network)], env=env)
        c.run("dev-fabric-peer-start", [*compose, "up", "-d", "agritrace-dev-orderer", "agritrace-dev-peer1", "agritrace-dev-peer2"])
        c.run("dev-fabric-channel", ["bash", "-c", 'cd -- "$1"; exec bash scripts/createChannel.sh agritrace-dev 2 20 false 0', "bash", str(network)], env=env)
        bound = dict(c.config, fabric=descriptor(), fabric_enabled=True)
        active = Controller(bound)
        record = c.record(c.state()["current"])
        package = active.storage / "records" / record["id"] / "chaincode.tgz"
        active.peer("dev-fabric-package", 1, "package", str(package), "--path", str(Path(record["directory"]) / "blockchain/chaincode"), "--lang", "node", "--label", "agritrace-" + record["sha"])
        package_id = active.peer("dev-fabric-package-id", 1, "calculatepackageid", str(package)).decode().strip()
        for org in (1, 2):
            active.peer("dev-fabric-install", org, "install", str(package))
        definition = active.lifecycle({"1": package_id, "2": package_id}, "cd-" + record["sha"][:12], 1)
        credentials = json.loads((ROOT / "ca-secrets.json").read_text())
        ca = ROOT / "working/bin/fabric-ca-client"
        tls = network / "organizations/fabric-ca/org1/tls-cert.pem"
        admin = network / "organizations/peerOrganizations/org1.agritrace-dev.local"
        relayer = ROOT / "identities/relayer"
        relayer.mkdir(parents=True, mode=0o700)
        adminenv = dict(env, FABRIC_CA_CLIENT_HOME=str(admin))
        active.run("dev-fabric-relayer-register", [str(ca), "register", "--caname", "ca-org1", "--id.name", "agritrace-dev-relayer", "--id.secret", credentials["RELAYER"], "--id.type", "client", "--id.attrs", "app.role=relayer:ecert", "--tls.certfiles", str(tls)], env=adminenv)
        active.run("dev-fabric-relayer-enroll", [str(ca), "enroll", "-u", "https://agritrace-dev-relayer:" + credentials["RELAYER"] + "@localhost:27054", "--caname", "ca-org1", "--enrollment.attrs", "app.role", "--tls.certfiles", str(tls)], env=dict(env, FABRIC_CA_CLIENT_HOME=str(relayer)))
        shutil.copyfile(admin / "msp/config.yaml", relayer / "msp/config.yaml")
        for path in [relayer / "msp", *(relayer / "msp").rglob("*")]:
            os.chown(path, 1001, 1001)
            path.chmod(0o700 if path.is_dir() else 0o600)
        # The mounted public TLS root must be readable by the unprivileged Worker.
        Path(descriptor()["peers"]["1"]["tls"]).chmod(0o644)
        active.run("dev-fabric-retain-stopped", ["docker", "stop", "--time", "20", *bound["fabric"]["containers"]])
        atomic_json(ROOT / "provisioned.json", {"source": record["sha"], "samples": SAMPLES, "definition": definition, "binding": descriptor(), "result": "provisioned-stopped"})
        # Configuration is installed only after the complete network is retained.
        additions = {"FABRIC_CHANNEL_NAME": "agritrace-dev", "FABRIC_CHAINCODE_NAME": "agritrace", "FABRIC_MSP_ID": "Org1MSP",
                     "FABRIC_PEER_ENDPOINT": "agritrace-dev-peer1:27051", "FABRIC_PEER_HOST_ALIAS": "agritrace-dev-peer1", "WORKER_UID": "1001", "WORKER_GID": "1001",
                     "RELAYER_MSP_DIR_HOST": str(relayer / "msp"), "FABRIC_TLS_CERT_HOST": descriptor()["peers"]["1"]["tls"]}
        policy.require(not set(additions).intersection(c.environment), "Existing signer configuration needs review")
        envfile = Path(c.config["env"])
        shutil.copyfile(envfile, ROOT / "pre-fabric.env")
        shutil.copyfile(CONFIG, ROOT / "pre-fabric-config.json")
        replacement = envfile.with_suffix(".fabric-next")
        replacement.write_text(envfile.read_text().rstrip() + "\n" + "".join(f"{key}={value}\n" for key, value in additions.items()))
        replacement.chmod(0o600)
        os.replace(replacement, envfile)
        config = dict(c.config, fabric=descriptor(), fabric_enabled=False)
        policy.targets.validate_config(config, policy.require)
        atomic_json(CONFIG, config)
        (ROOT / "provisioning.json").unlink()
        return {"result": "provisioned-stopped", "source": record["sha"], "channel": "agritrace-dev", "sequence": 1}
    except Exception:
        # Only catalogued dev containers; preserve every identity and ledger.
        for name in HOSTS.values():
            inspected = subprocess.run(["docker", "inspect", name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if inspected.returncode == 0:
                metadata = json.loads(inspected.stdout)[0]
                if metadata["Config"].get("Labels", {}).get("agritrace.environment") == "development" and "agritrace-dev-fabric" in metadata["NetworkSettings"]["Networks"]:
                    subprocess.run(["docker", "stop", "--time", "20", metadata["Id"]], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare", "provision"))
    args = parser.parse_args()
    policy.require(os.getuid() == 0, "Run as administrator")
    os.umask(0o077)
    config = json.loads(CONFIG.read_text())
    policy.targets.validate_config(config, policy.require)
    policy.require(config["environment"] == "development" and config["enabled"] and not config["fabric_enabled"], "Only initialized light dev can be provisioned")
    with administrator_lock(config["base"]), contextlib.ExitStack() as stack:
        import fcntl
        host = stack.enter_context(Path(config["host_lock"]).open("a"))
        fcntl.flock(host, fcntl.LOCK_EX | fcntl.LOCK_NB)
        c = Controller(config)
        policy.require(c.state()["current"] and not (c.storage / "runtime-toggle.json").exists(), "Reconcile release/runtime first")
        result = prepare(c) if args.operation == "prepare" else provision(c)
        print(json.dumps(result))


if __name__ == "__main__":
    main()
