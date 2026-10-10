#!/usr/bin/env python3
"""Reviewed administrator-only HTTPS aliases; never builds or migrates the app."""
import argparse
import contextlib
import copy
import datetime
import hashlib
import importlib.util
import ipaddress
import json
import os
import re
import signal
import socket
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit


def require(condition, message):
    if not condition:
        raise ValueError(message)


def https_alias(value):
    parsed = urlsplit(value)
    host = parsed.hostname or ""
    require(value == f"https://{host}" and len(host) <= 253 and len(host.split(".")) >= 2 and
            all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in host.split(".")),
            "Aliases must be lowercase HTTPS domain origins without paths, ports, or credentials")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return value
    raise ValueError("An HTTPS alias must be a DNS hostname")


def alias_environment(environment, additions):
    https_alias(environment["PUBLIC_ORIGIN"])
    aliases = list(dict.fromkeys(filter(None, environment.get("PUBLIC_ALIAS_ORIGINS", "").split(","))))
    for value in additions:
        if value not in aliases:
            aliases.append(value)
    require(0 < len(aliases) <= 8, "Specify between one and eight HTTPS aliases")
    for value in aliases:
        https_alias(value)
    sites = [value.strip() for value in environment["CADDY_SITE_ADDRESS"].split(",")]
    cors = environment["CORS_ORIGINS"].split(",")
    require(environment["PUBLIC_ORIGIN"] in cors and urlsplit(environment["PUBLIC_ORIGIN"]).hostname in sites,
            "The primary origin must already be configured in Caddy and CORS")
    for value in aliases:
        host = urlsplit(value).hostname
        if host not in sites:
            sites.append(host)
        if value not in cors:
            cors.append(value)
    return {**environment, "PUBLIC_ALIAS_ORIGINS": ",".join(aliases),
            "CADDY_SITE_ADDRESS": ", ".join(sites), "CORS_ORIGINS": ",".join(cors)}


def replace_environment(raw, values):
    """Keep every unrelated environment line, including secrets, byte-for-byte."""
    lines = raw.decode("utf-8").splitlines(keepends=True)
    seen = set()
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0]
        if key in values:
            require(key not in seen, "Duplicate public environment setting")
            require(not any(c in values[key] for c in "\r\n\0"), "Invalid environment framing")
            ending = "\r\n" if line.endswith("\r\n") else "\n"
            lines[index] = f"{key}={values[key]}{ending}"
            seen.add(key)
    for key in values.keys() - seen:
        require(not any(c in values[key] for c in "\r\n\0"), "Invalid environment framing")
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append(f"{key}={values[key]}\n")
    return "".join(lines).encode("utf-8")


def atomic_write(path, data):
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".alias-", delete=False) as output:
        temporary = Path(output.name)
        os.chmod(temporary, 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    try:
        os.replace(temporary, path)
        descriptor = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def delivery_lock(base):
    import fcntl
    require(os.getuid() == 0, "Run the reviewed alias command as administrator")
    with (base / "cd/delivery.lock").open("a") as lock:
        os.chmod(lock.name, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError("Another delivery is running; no alias configuration was changed")
        require(not (base / "cd/journal.json").exists(), "Recover the interrupted delivery first")
        yield


def load_controller(config):
    # Use the installed, trusted helper; do not replace its four manifest hashes.
    path = Path("/usr/local/lib/agri-trace-cd/controller.py")
    spec = importlib.util.spec_from_file_location("installed_cd_controller", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Controller(config)


def compose(controller, record, *arguments, overlay=None):
    root = Path(record["directory"])
    files = [root / name for name in ("docker-compose.uat.yml", "docker-compose.uat-https.yml", "docker-compose.uat-fabric.yml")]
    files.append(controller.storage / "records" / record["id"] / "images.json")
    command = ["docker", "compose", "--project-name", "agri-trace-uat", "--env-file", controller.config["env"],
               "--env-file", str(controller.storage / "records" / record["id"] / "origin.env")]
    if overlay:
        command += ["--env-file", str(overlay)]
    for path in files:
        command += ["-f", str(path)]
    return [*command, *arguments]


def unchanged_model(before, after):
    expected = copy.deepcopy(after)
    for service, key in (("api", "CORS_ORIGIN"), ("proxy", "CADDY_SITE_ADDRESS")):
        expected["services"][service]["environment"][key] = before["services"][service]["environment"][key]
    require(before == expected, "Alias changes would alter settings outside API CORS and Caddy hostnames")


def runtime(controller):
    names = controller.run("alias-container-names", ["docker", "ps", "--format", "{{.Names}}"]).decode().splitlines()
    selected = [name for name in names if name.startswith("agri-trace-uat-") or name in
                {"ca_org1", "ca_org2", "ca_orderer", "orderer.example.com", "peer0.org1.example.com", "peer0.org2.example.com"}]
    rows = json.loads(controller.run("alias-runtime", ["docker", "inspect", *selected]))
    return {row["Name"].lstrip("/"): {"id": row["Id"], "image": row["Image"], "status": row["State"]["Status"],
            "health": row["State"].get("Health", {}).get("Status")} for row in rows}


def preserve_runtime(before, after):
    require(before.keys() == after.keys(), "The running service set changed")
    for name in before:
        require(before[name]["image"] == after[name]["image"], "A runtime image changed")
        if name not in {"agri-trace-uat-api-1", "agri-trace-uat-proxy-1"}:
            require(before[name]["id"] == after[name]["id"], "A service outside API/proxy was recreated")
        require(after[name]["status"] == "running" and after[name]["health"] in {None, "healthy"},
                "A runtime service is unhealthy")


def data_fingerprints(controller, record):
    query = "SELECT json_build_object(" + ",".join(
        f"'{table}', (SELECT coalesce(json_object_agg({key}::text, md5(to_jsonb(t)::text)), '{{}}'::json) FROM {table} t)"
        for table, key in (("trace_event", "event_id"), ("blockchain_proof", "event_id"), ("trace_qr", "trace_qr_id"))) + ")"
    command = compose(controller, record, "exec", "-T", "postgres", "psql", "-U", controller.environment["POSTGRES_USER"],
                      "-d", controller.environment["POSTGRES_DB"], "-v", "ON_ERROR_STOP=1", "-At", "-c", query)
    return json.loads(controller.run("alias-history-fingerprints", command))


def preserve_data(before, after):
    for table, rows in before.items():
        require(all(after.get(table, {}).get(key) == value for key, value in rows.items()),
                "Existing event, proof, or QR data changed")


def verify_public(environment, timeout=180):
    primary = environment["PUBLIC_ORIGIN"]
    hostname = urlsplit(primary).hostname.removeprefix("www.")
    configured = [primary, f"https://www.{hostname}", *environment.get("PUBLIC_ALIAS_ORIGINS", "").split(",")]
    origins = list(dict.fromkeys(filter(None, configured)))
    deadline = time.monotonic() + timeout
    while True:
        try:
            for origin in filter(None, origins):
                for path in ("/login", "/api/health"):
                    with urllib.request.urlopen(origin + path, timeout=8) as response:
                        require(response.status == 200 and response.url == origin + path,
                                "An HTTPS alias failed or redirected to another origin")
                try:
                    urllib.request.urlopen(origin + "/api/docs", timeout=8)
                    raise ValueError("Swagger became publicly accessible")
                except urllib.error.HTTPError as error:
                    require(error.code == 404, "Unexpected public Swagger response")
            allowed = environment["CORS_ORIGINS"].split(",")
            for origin in [*allowed, "https://unapproved.example"]:
                request = urllib.request.Request(primary + "/api/auth/login", method="OPTIONS", headers={
                    "Origin": origin, "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "content-type,authorization,idempotency-key"})
                with urllib.request.urlopen(request, timeout=8) as response:
                    require(response.status == 204 and response.headers.get("Access-Control-Allow-Origin") ==
                            (origin if origin in allowed else None), "CORS verification failed")
            return origins
        except (OSError, ValueError):
            if time.monotonic() >= deadline:
                raise ValueError("Public HTTPS/CORS verification failed; restoring previous configuration") from None
            time.sleep(3)


def start_targets(controller, record):
    for name in ("api", "proxy"):
        controller.run("alias-start-" + name, compose(controller, record, "up", "-d", "--no-deps", "--no-build",
                       "--pull", "never", "--wait", "--wait-timeout", "120", name), timeout=150)


def transition(controller, record, environment_file, release_file, target, old_environment, old_release, verify):
    """Restore both config files and the old containers after any rollout failure."""
    try:
        atomic_write(environment_file, target)
        controller.environment = dict(line.split("=", 1) for line in target.decode().splitlines()
                                      if "=" in line and not line.startswith("#"))
        controller.write_release_environment(record)
        controller.preflight(record)
        start_targets(controller, record)
        return verify()
    except BaseException:
        atomic_write(environment_file, old_environment)
        atomic_write(release_file, old_release)
        controller.environment = dict(line.split("=", 1) for line in old_environment.decode().splitlines()
                                      if "=" in line and not line.startswith("#"))
        start_targets(controller, record)
        verify_public(controller.environment, timeout=60)
        raise


def execute(args):
    base = Path(args.base).resolve(strict=True)
    os.umask(0o077)
    with delivery_lock(base):
        config = json.loads(Path("/etc/agri-trace-cd/config.json").read_text())
        require(config["base"] == str(base), "Unexpected deployment base")
        controller = load_controller(config)
        state_raw = (controller.storage / "state.json").read_bytes()
        state = json.loads(state_raw)
        require(state["current"] == args.expected_current, "The active release changed; inspect it before retrying")
        record = controller.record(state["current"])
        require(record.get("verified") and controller.origin_for(record) == config["origin"] == controller.environment["PUBLIC_ORIGIN"],
                "Require a verified release using the installed primary HTTPS origin")
        environment_file = Path(config["env"])
        release_file = controller.storage / "records" / record["id"] / "origin.env"
        original, original_release = environment_file.read_bytes(), release_file.read_bytes()
        backup_root = controller.storage / "domain-aliases"
        if args.rollback:
            require(re.fullmatch(r"[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}", args.rollback), "Invalid alias backup ID")
            backup = backup_root / args.rollback
            metadata = json.loads((backup / "metadata.json").read_text())
            require(metadata["current"] == state["current"] and metadata["targetHash"] == hashlib.sha256(original).hexdigest(),
                    "Configuration changed after the alias operation; reconcile before rollback")
            target = (backup / "environment.before").read_bytes()
            target_environment = dict(line.split("=", 1) for line in target.decode().splitlines()
                                      if "=" in line and not line.startswith("#"))
        else:
            target_environment = alias_environment(controller.environment, args.alias)
            public = {key: target_environment[key] for key in ("PUBLIC_ALIAS_ORIGINS", "CADDY_SITE_ADDRESS", "CORS_ORIGINS")}
            target = replace_environment(original, public)
            expected_ip = urlsplit(config["legacy_origin"]).hostname
            for origin in target_environment["PUBLIC_ALIAS_ORIGINS"].split(","):
                addresses = {item[4][0] for item in socket.getaddrinfo(urlsplit(origin).hostname, 443)}
                require(addresses == {expected_ip}, "Alias DNS must resolve only to this deployment's IPv4 address")
        # Resolve both complete Compose models without printing credentials or changing active files.
        with tempfile.TemporaryDirectory(prefix="alias-plan-", dir=controller.storage) as temporary:
            overlay = Path(temporary) / "public.env"
            overlay.write_text("\n".join(f"{key}={target_environment.get(key, '')}" for key in
                                        ("CADDY_SITE_ADDRESS", "CORS_ORIGINS")) + "\n")
            before = json.loads(controller.run("alias-compose-before", compose(controller, record, "--profile", "tools", "config", "--format", "json")))
            after = json.loads(controller.run("alias-compose-after", compose(controller, record, "--profile", "tools", "config", "--format", "json", overlay=overlay)))
            unchanged_model(before, after)
            controller.run("alias-caddy-validation", ["docker", "exec", "-e", "CADDY_SITE_ADDRESS=" + target_environment["CADDY_SITE_ADDRESS"],
                           "agri-trace-uat-proxy-1", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
        summary = {"current": state["current"], "primaryOrigin": target_environment["PUBLIC_ORIGIN"],
                   "aliases": list(filter(None, target_environment.get("PUBLIC_ALIAS_ORIGINS", "").split(","))),
                   "servicesToRecreate": ["api", "proxy"]}
        if not args.apply:
            print(json.dumps({"result": "plan", **summary}))
            return
        containers_before = runtime(controller)
        history_before = data_fingerprints(controller, record)
        stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + os.urandom(4).hex()
        backup = backup_root / stamp
        backup.mkdir(mode=0o700, parents=True)
        atomic_write(backup / "environment.before", original)
        atomic_write(backup / "release.before", original_release)
        metadata = {**summary, "targetHash": hashlib.sha256(target).hexdigest(), "runtimeBefore": containers_before,
                    "historyBefore": history_before, "rollbackOf": args.rollback}
        atomic_write(backup / "metadata.json", json.dumps(metadata, indent=2).encode())

        def verify():
            origins = verify_public(target_environment)
            preserve_runtime(containers_before, runtime(controller))
            preserve_data(history_before, data_fingerprints(controller, record))
            require((controller.storage / "state.json").read_bytes() == state_raw, "The CD release state changed")
            # The installed verifier understands the currently deployed auth contract.
            evidence = controller.verify(record)
            atomic_write(backup / "verification.json", json.dumps(evidence, indent=2).encode())
            return {"result": "passed", **summary, "publicOrigins": origins, "backupId": stamp,
                    "historyRowsPreserved": {key: len(value) for key, value in history_before.items()},
                    "roles": evidence.get("roles"), "verifiedQR": evidence.get("verifiedQR")}

        result = transition(controller, record, environment_file, release_file, target, original, original_release, verify)
        atomic_write(backup / "result.json", json.dumps(result, indent=2).encode())
        print(json.dumps(result))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="/opt/agri-trace")
    parser.add_argument("--expected-current", required=True)
    parser.add_argument("--alias", action="append", default=[])
    parser.add_argument("--rollback", help="Backup ID returned by a previous successful alias operation")
    parser.add_argument("--apply", action="store_true", help="Apply the checked plan; otherwise preview only")
    args = parser.parse_args()
    require(bool(args.alias) != bool(args.rollback), "Specify aliases or one rollback backup ID")
    def interrupted(*_):
        raise InterruptedError("Alias operation interrupted")

    for signum in {signal.SIGINT, signal.SIGTERM, getattr(signal, "SIGHUP", signal.SIGTERM)}:
        signal.signal(signum, interrupted)
    execute(args)


if __name__ == "__main__":
    main()
