#!/usr/bin/env python3
"""Administrator-only production install/adoption and activation.

No path to this program is granted to a delivery SSH key. Configuration is
root-owned; existing production state and data are adopted without seeding.
"""
import argparse
import contextlib
import json
import os
import re
import shutil
import signal
import subprocess
import datetime
from pathlib import Path
import install as legacy

Controller, atomic_json, policy = legacy.Controller, legacy.atomic_json, legacy.policy


def config_path(environment):
    return Path("/etc/agri-trace-cd") / policy.targets.TARGETS[environment]["prefix"] / "config.json"


def provision_identity(environment, public_key):
    prefix = policy.targets.TARGETS[environment]["prefix"]
    require = policy.require
    require(bool(re.fullmatch(r"ssh-ed25519 [A-Za-z0-9+/=]+(?: [a-zA-Z0-9_.@-]+)?", public_key)), "Expected one dedicated public key")
    user = "agri-cd-" + prefix
    if subprocess.run(["id", user], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["useradd", "--create-home", "--shell", "/bin/bash", user], check=True)
    subprocess.run(["passwd", "-l", user], check=True, stdout=subprocess.DEVNULL)
    wrapper = Path("/usr/local/lib/agri-trace-cd") / ("entry-" + prefix)
    wrapper.write_text("#!/bin/sh\nexec /usr/bin/python3 -I /usr/local/lib/agri-trace-cd/" + prefix +
                       '/controller.py --config /etc/agri-trace-cd/' + prefix + '/config.json --command "${1-}"\n')
    wrapper.chmod(0o755)
    os.chown(wrapper, 0, 0)
    ssh = Path("/home") / user / ".ssh"
    ssh.mkdir(mode=0o755, exist_ok=True)
    ssh.chmod(0o755)
    os.chown(ssh, 0, 0)
    authorized = ssh / "authorized_keys"
    authorized.write_text('restrict,command="sudo -n ' + str(wrapper) + ' \\"$SSH_ORIGINAL_COMMAND\\"" ' + public_key + "\n")
    authorized.chmod(0o644)
    os.chown(authorized, 0, 0)
    sudo = Path("/etc/sudoers.d") / ("agri-trace-cd-" + prefix)
    sudo.write_text(user + " ALL=(root) NOPASSWD: " + str(wrapper) + "\n")
    sudo.chmod(0o440)
    subprocess.run(["visudo", "-cf", str(sudo)], check=True, stdout=subprocess.DEVNULL)
    return user


def installed_helpers(environment):
    prefix = policy.targets.TARGETS[environment]["prefix"]
    installed = Path("/usr/local/lib/agri-trace-cd") / prefix
    installed.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name in policy.CONTROLLER_FILES:
        temporary = installed / (name + ".next")
        shutil.copyfile(Path(__file__).with_name(name), temporary)
        temporary.chmod(0o755 if name == "entry" else 0o644)
        os.chown(temporary, 0, 0)
        os.replace(temporary, installed / name)


def legacy_production_config():
    old = json.loads(Path("/etc/agri-trace-cd/config.json").read_text())
    policy.require(old["base"] == "/opt/agri-trace" and old["origin"] == "https://agritrace.dev", "Unexpected legacy target")
    samples = Path(old["network_root"]) / "blockchain/.fabric/fabric-samples"
    organizations = samples / "test-network/organizations"
    certificate = Path("/opt/agri-trace/shared/config/backup-recipient.pem")
    shutil.copyfile(old["backup_certificate"], certificate)
    certificate.chmod(0o600)
    fabric = {"network": "fabric_test", "root": old["network_root"], "channel": "agritrace", "chaincode": "agritrace",
              "containers": ["ca_org1", "ca_org2", "ca_orderer", "orderer.example.com", "peer0.org1.example.com", "peer0.org2.example.com"],
              "volumes": ["compose_orderer.example.com", "compose_peer0.org1.example.com", "compose_peer0.org2.example.com"],
              "peer_binary": str(samples / "bin/peer"), "config_path": str(samples / "config"),
              "backup_paths": [str(organizations), str(Path(old["network_root"]) / "blockchain/network/identities"),
                               str(Path(old["network_root"]) / "blockchain/network/.env")], "peers": {}}
    for org, port in ((1, 7051), (2, 9051)):
        root = organizations / f"peerOrganizations/org{org}.example.com"
        fabric["peers"][str(org)] = {"address": f"localhost:{port}", "msp_id": f"Org{org}MSP",
                                    "hostname": f"peer0.org{org}.example.com",
                                    "msp": str(root / f"users/Admin@org{org}.example.com/msp"),
                                    "tls": str(root / f"peers/peer0.org{org}.example.com/tls/ca.crt")}
    fabric["orderer"] = {"address": "localhost:7050", "hostname": "orderer.example.com",
                         "tls": str(organizations / "ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt")}
    return dict(old, schema=2, environment="production", branch="main", project="agri-trace-uat", profile="fabric",
                enabled=False, fabric=fabric, ingress="agritrace-prod-ingress", postgres_volume="agri-trace-uat_postgres-data",
                host_lock="/run/lock/agri-trace-host.lock", backup_certificate=str(certificate), edge_adopted=True,
                legacy_cors_origins=["http://13.140.170.166"],
                canary={"farmId": "6bb639b5-924a-4e82-8d80-000000000201", "plotId": "6bb639b5-924a-4e82-8d80-000000000203", "productId": "6bb639b5-924a-4e82-8d80-000000000202"})


def install_target(args, config):
    policy.targets.validate_config(config, policy.require)
    base = Path(config["base"])
    for directory in (base / "cd", base / "releases", base / "backups"):
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    target_file = config_path(args.environment)
    if target_file.exists():
        previous = json.loads(target_file.read_text())
        for name in ("base", "project", "postgres_volume", "environment", "branch", "origin"):
            policy.require(previous[name] == config[name], "Installed resource mapping cannot be replaced implicitly")
    controller = Controller(config)
    if args.environment == "production":
        policy.require((base / "cd/state.json").exists(), "Adoption requires the existing verified controller state")
        record = controller.record(controller.state()["current"])
        policy.require(record.get("verified"), "Legacy current release is unverified")
        inspect = json.loads(subprocess.check_output(["docker", "inspect", config["project"] + "-postgres-1"]))[0]
        policy.require(any(m.get("Name") == config["postgres_volume"] and m["Destination"] == "/var/lib/postgresql" for m in inspect["Mounts"]), "Existing PGDATA mapping differs")
        # Exact state/current/history are retained. No seed, migration or restart.
        atomic_json(base / "cd/target-adoption.json", {"environment": "production", "current": record["id"], "project": config["project"], "postgres_volume": config["postgres_volume"]})
    installed_helpers(args.environment)
    atomic_json(target_file, config)
    user = provision_identity(args.environment, Path(args.public_key).read_text().strip())
    return {"result": "installed", "environment": args.environment, "user": user, "enabled": config["enabled"]}


def install_fresh(args, config):
    """Retire controller metadata only, after an independently restored archive.

    Existing PGDATA/ledger/crypto are never deleted, migrated or reused here.
    A first CD delivery must still prove that the new database is empty.
    """
    policy.targets.validate_config(config, policy.require)
    policy.require(config["schema"] == 3 and config["enabled"] is False, "Fresh target must start disabled")
    base = Path(config["base"])
    previous_file = config_path(args.environment)
    previous = json.loads(previous_file.read_text())
    policy.require(previous.get("schema") == 2 and previous.get("enabled") is False, "Disable the old installed target before replacement")
    policy.require(previous["project"] != config["project"] and previous["postgres_volume"] != config["postgres_volume"], "Fresh target cannot reuse old PGDATA")
    evidence_file = config.get("restore_evidence", "")
    policy.require(policy.targets.owned_path(evidence_file, base / "shared"), "Private restoration evidence is required")
    evidence = json.loads(Path(evidence_file).read_text())
    policy.require(evidence.get("protocol") == "agritrace-backup-restore/1" and evidence.get("result") == "passed" and
                   evidence.get("source_project") == previous["project"] and evidence.get("source_volume") == previous["postgres_volume"] and
                   evidence.get("off_vps") is True and evidence.get("database_restored") is True and evidence.get("ledger_restored") is True,
                   "Fresh target needs a verified off-VPS database and ledger restoration")
    archive = Path(evidence.get("encrypted_archive", ""))
    policy.require(policy.targets.owned_path(archive, base / "backups") and archive.is_file() and
                   policy.sha256(archive.read_bytes()) == evidence.get("archive_sha256"), "Verified encrypted backup is missing or changed")
    running = subprocess.check_output(["docker", "ps", "-q", "--filter", "label=com.docker.compose.project=" + previous["project"]], text=True).strip()
    policy.require(not running, "Stop every old application container before fresh installation")
    names = previous.get("fabric", {}).get("containers", [])
    if names:
        resources = json.loads(subprocess.check_output(["docker", "inspect", *names]))
        policy.require(all(not resource["State"].get("Running") for resource in resources), "Stop the old Fabric network before fresh installation")
    policy.require(subprocess.run(["docker", "volume", "inspect", config["postgres_volume"]], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL).returncode != 0, "Fresh PGDATA already exists; reconcile it without resetting")
    retired = base / "cd" / "retired" / datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    retired.mkdir(parents=True, mode=0o700)
    shutil.copyfile(previous_file, retired / "config.json")
    for name in ("state.json", "hybrid-floor.json", "last-result.json", "target-adoption.json"):
        source = base / "cd" / name
        if source.exists():
            shutil.copyfile(source, retired / name)
            if name == "hybrid-floor.json":
                source.unlink()  # Archived old schema floor belongs to the retired DB.
    current = base / "current"
    if current.is_symlink():
        (retired / "previous-release").symlink_to(current.resolve())
        current.unlink()
    elif current.exists():
        policy.require(False, "Current release is not the expected symlink")
    atomic_json(base / "cd/state.json", {"current": None, "previous": None, "chaincode": {"sequence": 0}, "compatible_migrations": []})
    installed_helpers(args.environment)
    atomic_json(previous_file, config)
    user = provision_identity(args.environment, Path(args.public_key).read_text().strip())
    return {"result": "fresh-target-installed", "environment": args.environment, "user": user, "enabled": False, "retired": str(retired)}






def lifecycle(environment, operation, config):
    policy.require(environment == "production" and operation == "enable", "Only production activation is supported")
    config["enabled"] = True
    atomic_json(config_path(environment), config)
    return {"result": "enabled", "environment": environment}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("install", "fresh-install", "adopt-legacy", "enable"))
    parser.add_argument("--environment", choices=policy.targets.TARGETS, required=True)
    parser.add_argument("--config")
    parser.add_argument("--public-key")
    args = parser.parse_args()
    policy.require(os.getuid() == 0, "Run environment administration as root")
    os.umask(0o077)
    if args.operation == "adopt-legacy":
        policy.require(args.environment == "production" and bool(args.public_key), "Legacy adoption only installs the production identity")
        base = "/opt/agri-trace"
    else:
        config = json.loads(Path(args.config if args.operation in {"install", "fresh-install"} else config_path(args.environment)).read_text())
        policy.targets.validate_config(config, policy.require)
        policy.require(config["environment"] == args.environment, "Administrator environment mismatch")
        base = config["base"]
    with legacy.administrator_lock(base), contextlib.ExitStack() as stack:
        import fcntl
        host = stack.enter_context(Path("/run/lock/agri-trace-host.lock").open("a"))
        try:
            fcntl.flock(host, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise policy.PolicyError("Another host deployment is running; no configuration was changed")
        if args.operation == "adopt-legacy":
            config = legacy_production_config()
        if args.operation in {"install", "adopt-legacy", "fresh-install"}:
            policy.require(bool(args.public_key), "Install requires a dedicated CD public key")
            result = install_fresh(args, config) if args.operation == "fresh-install" else install_target(args, config)
        else:
            result = lifecycle(args.environment, args.operation, config)
        print(json.dumps(result))


if __name__ == "__main__":
    def interrupted(*_):
        raise policy.PolicyError("Environment administration was interrupted")
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    main()
