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
    """Switch the controller and its restore marker; undo the switch if either step fails."""
    link = library / prefix
    versions = library / (prefix + "-versions")
    converted = None
    previous = None
    if link.is_symlink():
        previous = Path(os.readlink(link))
    elif link.exists():
        # First conversion preserves every old helper, including files outside the new helper set.
        converted = versions / ("plain-" + datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))
        os.rename(link, converted)
        previous = converted
    temporary = library / (prefix + ".next")
    marker = versions / "previous.next"
    try:
        if temporary.is_symlink() or temporary.exists():
            temporary.unlink()
        temporary.symlink_to(release, target_is_directory=True)
        os.replace(temporary, link)
        if previous is not None and previous != release:
            marker.write_text(str(previous) + "\n")
            os.replace(marker, versions / "previous")
    except BaseException:
        for pending in (temporary, marker):
            with contextlib.suppress(OSError):
                pending.unlink()
        if converted is not None:
            if link.is_symlink() and Path(os.readlink(link)) == release:
                link.unlink()
            if not link.exists() and not link.is_symlink():
                os.rename(converted, link)
        elif link.is_symlink() and Path(os.readlink(link)) == release and previous != release:
            if previous is None:
                link.unlink()
            else:
                temporary.symlink_to(previous, target_is_directory=True)
                os.replace(temporary, link)
        raise
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


def lifecycle(environment, operation, config):
    policy.require(environment == "production" and operation == "enable", "Only production activation is supported")
    config["enabled"] = True
    atomic_json(config_path(environment), config)
    return {"result": "enabled", "environment": environment}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("enable", "controller-digest", "update-controller", "restore-controller"))
    parser.add_argument("--environment", choices=policy.targets.TARGETS)
    parser.add_argument("--expected-digest")
    args = parser.parse_args()
    if args.operation == "controller-digest":
        # Read-only: a reviewer prints this from the reviewed checkout and passes it to update-controller.
        print(json.dumps({"digest": controller_digest(Path(__file__).parent)[0]}))
        return
    policy.require(args.environment is not None, "An environment is required")
    policy.require(os.getuid() == 0, "Run environment administration as root")
    os.umask(0o077)
    config = json.loads(config_path(args.environment).read_text())
    policy.targets.validate_config(config, policy.require)
    policy.require(config["environment"] == args.environment, "Administrator environment mismatch")
    with administrator_lock(config["base"]), contextlib.ExitStack() as stack:
        import fcntl
        host = stack.enter_context(Path("/run/lock/agri-trace-host.lock").open("a"))
        try:
            fcntl.flock(host, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise policy.PolicyError("Another host deployment is running; no configuration was changed")
        if args.operation == "update-controller":
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
