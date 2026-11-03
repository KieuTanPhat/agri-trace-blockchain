#!/usr/bin/env python3
"""Root operator runner for the 28-product dataset on a freshly reinstalled production.

  python3 -I production-dataset-run.py --bundle <extracted bundle dir> [--resume]

Seeds through the production API from a one-off container of the current
release's API image, then binds the dataset chains on the real ledger with the
installed (reviewed) controller's operator container and Worker inventory
update. It holds the delivery and host locks, never deletes or resets data,
and refuses any installation it did not pin. Interrupted runs continue with
--resume; checkpoints keep each command's original key and body.
"""
import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

CONTROLLER = Path("/usr/local/lib/agri-trace-cd/prod")
CONFIG = Path("/etc/agri-trace-cd/prod/config.json")
LEDGER_REQUIRED_EXIT = 75
sys.path.insert(0, str(CONTROLLER))
import controller as cd  # noqa: E402  (installed, reviewed controller)


def fail(message):
    raise SystemExit(json.dumps({"result": "failed", "message": message}))


def verify_bundle(bundle, sha):
    manifest = json.loads((bundle / "bundle.json").read_text())
    if manifest.get("protocol") != "agritrace-production-dataset-bundle/1" or manifest.get("sha") != sha:
        fail("Dataset bundle does not belong to the installed release")
    for name, digest in manifest["files"].items():
        path = (bundle / name).resolve()
        # The one-off container is root without capabilities: it reads only root-owned files.
        if path.stat().st_uid != 0:
            fail(f"Dataset bundle file is not owned by root (chown -R root:root the bundle): {name}")
        if not path.is_relative_to(bundle.resolve()) or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            fail(f"Dataset bundle file differs: {name}")
    return manifest


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, type=Path)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    if os.getuid() != 0:
        fail("Run as root on the production host")
    os.umask(0o077)
    config = json.loads(CONFIG.read_text())
    controller = cd.Controller(config)
    with contextlib.ExitStack() as stack:
        for name in (controller.storage / "delivery.lock", Path(config["host_lock"])):
            lock = stack.enter_context(Path(name).open("a"))
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail("A delivery is running; nothing was changed")
        run(controller, args)


def run(controller, args):
    state = controller.state()
    if state["current"] is None or (controller.storage / "journal.json").exists():
        fail("Production needs a verified release and no open journal")
    record = controller.record(state["current"])
    if not record.get("verified") or controller.fresh_write_mode(record) != "OPEN":
        fail("Business writes are not open on the current release")
    generation = state.get("installation_generation", "")
    verify_bundle(args.bundle, record["sha"])
    accounts = json.loads(Path(controller.config["accounts"]).read_text())
    directory = controller.base / "shared" / "dataset" / generation
    run_directory = directory / "run"
    target_file = run_directory / "target.json"
    target = {"protocol": "agritrace-production-dataset/1", "generation": generation,
              "baselineUserIds": sorted(account["id"] for account in accounts)}
    if args.resume:
        if json.loads(target_file.read_text()) != target:
            fail("Resume belongs to another installation")
    else:
        if directory.exists():
            fail("Dataset already started for this installation; use --resume")
        run_directory.mkdir(parents=True)
        cd.atomic_json(target_file, target)

    def container(script, extra=()):
        environment = controller.environment
        database = (f"postgresql://{environment['POSTGRES_USER']}:{environment['POSTGRES_PASSWORD']}"
                    f"@postgres:5432/{environment['POSTGRES_DB']}?schema=public")
        env_file = directory / "seed.env"
        descriptor = os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(descriptor, "w") as file:
            file.write("\n".join([f"DATABASE_URL={database}", "APP_ENV=production",
                                  "AGRITRACE_PRODUCTION_DATASET=true", f"AGRITRACE_INSTALLATION_GENERATION={generation}",
                                  f"PUBLIC_TRACE_BASE_URL={controller.config['origin']}/trace"]) + "\n")
        bundle = args.bundle.resolve()
        command = ["docker", "run", "--rm", "--user", "0:0", "--network", controller.project + "_default",
                   "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
                   "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m", "--memory", "768m", "--cpus", "1",
                   "--env-file", str(env_file),
                   "--mount", f"type=bind,src={bundle / 'scripts' / 'demo'},dst=/app/scripts/demo,readonly",
                   "--mount", f"type=bind,src={bundle / 'assets'},dst=/dataset-assets,readonly",
                   "--mount", f"type=bind,src={run_directory},dst=/dataset-run",
                   record["manifest"]["api"], "node", f"scripts/demo/{script}", *extra]
        log = directory / "seed.log"
        try:
            with log.open("ab") as output:
                return subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, timeout=6 * 3600).returncode
        finally:
            env_file.unlink(missing_ok=True)

    for attempt in range(8):
        code = container("full-seed.mjs")
        if code == 0:
            break
        if code != LEDGER_REQUIRED_EXIT:
            fail(f"full-seed.mjs exited {code}; see {directory / 'seed.log'}, then --resume")
        chain_ids = json.loads((run_directory / "ledger-required.json").read_text())["chainIds"]
        bind(controller, record, chain_ids)
        print(json.dumps({"phase": "ledger-bound", "chains": len(chain_ids)}), flush=True)
    else:
        fail("Seed kept requiring ledger bindings")
    for script, extra in (("publish-fruit-presentation.mjs", ()), ("publish-fruit-news.mjs", ()),
                          ("verify-seed.mjs", ("--fresh",) if not (run_directory / "receipt.json").exists() else ())):
        code = container(script, extra)
        if code != 0:
            fail(f"{script} exited {code}; see {directory / 'seed.log'}, then --resume")
    print(json.dumps({"result": "passed", "release": record["id"], "generation": generation,
                      "accounts": str(run_directory / "accounts.json")}), flush=True)


def bind(controller, record, chain_ids):
    payload = json.loads(Path(controller.config["bootstrap"]).read_text())
    payload["accounts"] = json.loads(Path(controller.config["accounts"]).read_text())
    payload.update(operation="dataset-ledger", chainIds=chain_ids)
    program = ["node", "apps/api/scripts/bootstrap-production.mjs"]
    for _ in range(len(chain_ids) + 1):
        result = controller.hosted_operator(record, dict(payload), program, "dataset-ledger-binding")
        if result.get("result") != "inventory-required":
            break
        # Same locked atomic inventory replace the controller uses for the smoke chain.
        controller.add_worker_binding(result.get("bindingDigest"), result.get("workerBinding"))
    if result.get("result") != "passed":
        fail("Dataset ledger binding did not complete")


if __name__ == "__main__":
    try:
        main()
    except cd.PolicyError as error:
        fail(str(error))
