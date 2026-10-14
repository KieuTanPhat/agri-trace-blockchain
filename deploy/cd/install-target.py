#!/usr/bin/env python3
"""Administrator-only production installation, controller updates and activation.

No path to this program is granted to a delivery SSH key. Configuration is
root-owned. The installed controller is one immutable, digest-named directory
that a symlink selects, so an update is a single atomic switch and the previous
version stays available for restoration.
"""
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
from pathlib import Path

spec = importlib.util.spec_from_file_location("cd_controller", Path(__file__).with_name("controller.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
atomic_json, policy = module.atomic_json, module.policy

LIBRARY = Path("/usr/local/lib/agri-trace-cd")


@contextlib.contextmanager
def administrator_lock(base):
    import fcntl
    policy.require(os.getuid() == 0, "Run the reviewed installer as administrator")
    storage = Path(base).resolve() / "cd"
    storage.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (storage / "delivery.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise policy.PolicyError("Another delivery is running; no configuration was changed")
        policy.require(not (storage / "journal.json").exists(), "Recover interrupted delivery before updating the controller")
        yield


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
    wrapper = LIBRARY / ("entry-" + prefix)
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


def controller_digest(source):
    """Digest of exactly the helper files a release manifest pins. Printing it lets a reviewer approve one value."""
    files = {name: policy.sha256((Path(source) / name).read_bytes()) for name in policy.CONTROLLER_FILES}
    return policy.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()), files


def _own(path):
    if os.getuid() == 0:
        os.chown(path, 0, 0)


def _version_directory(versions, digest, source):
    """Create (or verify) the immutable directory for this digest. The source is only read, never linked."""
    release = versions / digest
    if release.exists():
        recorded, files = controller_digest(release)
        policy.require(recorded == digest, "An installed controller version was modified")
        return release
    temporary = versions / (digest + ".partial")
    if temporary.exists():
        shutil.rmtree(temporary)
    temporary.mkdir(mode=0o755)
    try:
        for name in policy.CONTROLLER_FILES:
            target = temporary / name
            shutil.copyfile(Path(source) / name, target)
            target.chmod(0o755 if name == "entry" else 0o644)
            _own(target)
        _own(temporary)
        policy.require(controller_digest(temporary)[0] == digest, "Controller changed while it was being installed")
        os.rename(temporary, release)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return release


def activate_controller(prefix, release, library=LIBRARY):
    """Switch `<library>/<prefix>` to `release` atomically; undo everything if any step fails."""
    link = library / prefix
    versions = library / (prefix + "-versions")
    converted = None
    previous = None
    if link.is_symlink():
        previous = Path(os.readlink(link))
    elif link.exists():
        # First conversion from a plain directory. No delivery can run (the administrator holds its lock).
        converted = versions / ("plain-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        os.rename(link, converted)
        previous = converted
    temporary = library / (prefix + ".next")
    try:
        if temporary.is_symlink() or temporary.exists():
            temporary.unlink()
        temporary.symlink_to(release, target_is_directory=True)
        os.replace(temporary, link)
    except BaseException:
        with contextlib.suppress(OSError):
            temporary.unlink()
        if converted is not None and not link.exists() and not link.is_symlink():
            os.rename(converted, link)
        raise
    if previous is not None and previous != release:
        marker = versions / "previous.next"
        marker.write_text(str(previous) + "\n")
        os.replace(marker, versions / "previous")
    return previous


def update_controller(environment, source, expected_digest, library=LIBRARY):
    policy.require(bool(re.fullmatch(r"[a-f0-9]{64}", expected_digest or "")), "A reviewed 64-character controller digest is required")
    digest, _ = controller_digest(source)
    policy.require(digest == expected_digest, "Controller source differs from the reviewed digest; no installation was changed")
    prefix = policy.targets.TARGETS[environment]["prefix"]
    versions = library / (prefix + "-versions")
    versions.mkdir(mode=0o755, parents=True, exist_ok=True)
    release = _version_directory(versions, digest, source)
    previous = activate_controller(prefix, release, library)
    return {"result": "controller-updated", "environment": environment, "digest": digest,
            "previous": None if previous is None else previous.name}


def restore_controller(environment, library=LIBRARY):
    prefix = policy.targets.TARGETS[environment]["prefix"]
    versions = library / (prefix + "-versions")
    marker = versions / "previous"
    policy.require(marker.is_file(), "No previous controller version is recorded")
    previous = Path(marker.read_text().strip())
    policy.require(previous.parent == versions and previous.is_dir(), "The recorded controller version is unavailable")
    if re.fullmatch(r"[a-f0-9]{64}", previous.name):
        policy.require(controller_digest(previous)[0] == previous.name, "The recorded controller version was modified")
    for name in policy.CONTROLLER_FILES:
        policy.require((previous / name).is_file(), "The recorded controller version is incomplete")
    replaced = activate_controller(prefix, previous, library)
    return {"result": "controller-restored", "environment": environment, "digest": previous.name,
            "replaced": None if replaced is None else replaced.name}


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
    LIBRARY.mkdir(mode=0o755, parents=True, exist_ok=True)
    update_controller(args.environment, Path(__file__).parent, controller_digest(Path(__file__).parent)[0])
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
    parser.add_argument("operation", choices=("fresh-install", "enable", "controller-digest", "update-controller", "restore-controller"))
    parser.add_argument("--environment", choices=policy.targets.TARGETS)
    parser.add_argument("--config")
    parser.add_argument("--public-key")
    parser.add_argument("--expected-digest")
    args = parser.parse_args()
    if args.operation == "controller-digest":
        # Read-only: a reviewer prints this from the reviewed checkout and passes it to update-controller.
        print(json.dumps({"digest": controller_digest(Path(__file__).parent)[0]}))
        return
    policy.require(args.environment is not None, "An environment is required")
    policy.require(os.getuid() == 0, "Run environment administration as root")
    os.umask(0o077)
    config = json.loads(Path(args.config if args.operation == "fresh-install" else config_path(args.environment)).read_text())
    policy.targets.validate_config(config, policy.require)
    policy.require(config["environment"] == args.environment, "Administrator environment mismatch")
    with administrator_lock(config["base"]), contextlib.ExitStack() as stack:
        import fcntl
        host = stack.enter_context(Path("/run/lock/agri-trace-host.lock").open("a"))
        try:
            fcntl.flock(host, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise policy.PolicyError("Another host deployment is running; no configuration was changed")
        if args.operation == "fresh-install":
            policy.require(bool(args.public_key), "Install requires a dedicated CD public key")
            result = install_fresh(args, config)
        elif args.operation == "update-controller":
            result = update_controller(args.environment, Path(__file__).parent, args.expected_digest)
        elif args.operation == "restore-controller":
            result = restore_controller(args.environment)
        else:
            result = lifecycle(args.environment, args.operation, config)
        print(json.dumps(result))


if __name__ == "__main__":
    def interrupted(*_):
        raise policy.PolicyError("Environment administration was interrupted")
    for number in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(number, interrupted)
    main()
