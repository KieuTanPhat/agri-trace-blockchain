#!/usr/bin/env python3
"""Administrator-owned production Edge preparation, cutover and reload."""
import argparse
import contextlib
import datetime
import fcntl
import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path("/opt/agri-trace-edge")


def run(*args):
    return subprocess.check_output(args, stderr=subprocess.PIPE, timeout=240)


def compose(*args):
    return ["docker", "compose", "--project-name", "agritrace-edge", "--env-file", str(ROOT / ".env"),
            "-f", str(ROOT / "docker-compose.yml"), *args]


def config():
    return Path(__file__).with_name("Caddyfile").read_text()


def health():
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        try:
            for origin in ("https://agritrace.dev", "https://www.agritrace.dev"):
                with urllib.request.urlopen(origin + "/api/health", timeout=10) as response:
                    if response.status != 200:
                        raise RuntimeError("Production health failed after Edge change")
            return
        except Exception:
            time.sleep(3)
    raise RuntimeError("Production health failed after Edge change")


def validate(filename="Caddyfile"):
    values = dict(line.split("=", 1) for line in (ROOT / ".env").read_text().splitlines() if line)
    # Validation uses disposable storage; never mount live certificate volumes
    # into a second process before the old proxy has stopped.
    run("docker", "run", "--rm", "--tmpfs", "/data", "--tmpfs", "/config", "--tmpfs", "/tmp",
        "-v", str(ROOT / "config") + ":/etc/caddy:ro", values["CADDY_IMAGE"],
        "caddy", "validate", "--config", "/etc/caddy/" + filename)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("prepare", "cutover", "reload"))
    args = parser.parse_args()
    if os.getuid() != 0:
        raise RuntimeError("Edge administration requires root; delivery keys cannot change routes")
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with (ROOT / "edge.lock").open("a") as edge, Path("/opt/agri-trace/cd/delivery.lock").open("a") as production, Path("/run/lock/agri-trace-host.lock").open("a") as host:
        # Environment administration takes env->host; Edge takes edge->host.
        # Nobody holds host and waits for edge/env, and all locks fail fast.
        fcntl.flock(edge, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(production, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(host, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if args.operation == "prepare":
            (ROOT / "config").mkdir(mode=0o755, exist_ok=True)
            for network in ("agritrace-prod-ingress",):
                if subprocess.run(["docker", "network", "inspect", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
                    run("docker", "network", "create", network)
            for component in ("api", "web"):
                name = "agri-trace-uat-" + component + "-1"
                metadata = json.loads(run("docker", "inspect", name))[0]
                if "agritrace-prod-ingress" not in metadata["NetworkSettings"]["Networks"]:
                    run("docker", "network", "connect", "--alias", "prod-" + component, "agritrace-prod-ingress", name)
            legacy = json.loads(Path("/etc/agri-trace-cd/config.json").read_text())
            values = dict(line.split("=", 1) for line in Path(legacy["env"]).read_text().splitlines() if line and not line.startswith("#"))
            # Reuse the exact certificate volumes. Both proxies must never run together.
            env = {"CADDY_IMAGE": values["CADDY_IMAGE"], "EDGE_CONFIG_DIRECTORY": str(ROOT / "config"),
                   "EDGE_DATA_VOLUME": "agri-trace-uat_caddy-data", "EDGE_STATE_VOLUME": "agri-trace-uat_caddy-config"}
            for volume in (env["EDGE_DATA_VOLUME"], env["EDGE_STATE_VOLUME"]):
                run("docker", "volume", "inspect", volume)
            proxy = json.loads(run("docker", "inspect", "agri-trace-uat-proxy-1"))[0]
            mounts = {mount["Destination"]: mount.get("Name") for mount in proxy["Mounts"]}
            if mounts.get("/data") != env["EDGE_DATA_VOLUME"] or mounts.get("/config") != env["EDGE_STATE_VOLUME"]:
                raise RuntimeError("Legacy certificate volume mapping differs; no proxy was stopped")
            (ROOT / ".env").write_text("".join(k + "=" + v + "\n" for k, v in env.items()))
            (ROOT / ".env").chmod(0o600)
            shutil.copyfile(Path(__file__).with_name("docker-compose.yml"), ROOT / "docker-compose.yml")
            (ROOT / "config/Caddyfile").write_text(config())
            (ROOT / "config/Caddyfile").chmod(0o644)
            validate()
        elif args.operation == "cutover":
            validate()
            run("docker", "stop", "--time", "20", "agri-trace-uat-proxy-1")
            try:
                run(*compose("up", "-d", "--no-build", "--pull", "never", "proxy"))
                health()
            except Exception:
                run(*compose("stop", "proxy"))
                run("docker", "start", "agri-trace-uat-proxy-1")
                raise
        else:
            filename = ROOT / "config/Caddyfile"
            stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = ROOT / ("Caddyfile.before-" + stamp)
            shutil.copyfile(filename, backup)
            candidate = ROOT / "config/Caddyfile.next"
            candidate.write_text(config())
            candidate.chmod(0o644)
            validate("Caddyfile.next")
            os.replace(candidate, filename)
            try:
                run(*compose("exec", "-T", "proxy", "caddy", "reload", "--address", "unix//tmp/caddy-admin.sock", "--config", "/etc/caddy/Caddyfile"))
                health()
            except Exception:
                shutil.copyfile(backup, filename)
                run(*compose("exec", "-T", "proxy", "caddy", "reload", "--address", "unix//tmp/caddy-admin.sock", "--config", "/etc/caddy/Caddyfile"))
                raise
        print(json.dumps({"result": "passed", "operation": args.operation, "project": "agritrace-edge"}))


if __name__ == "__main__":
    main()
