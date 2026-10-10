#!/usr/bin/env python3
"""Administrator origin cutover: preserve API/Worker/Fabric, replace only Web URLs."""
import argparse
import copy
import hashlib
import json
import os
import re
import signal
import socket
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import aliases


def environment_for(environment, origin, legacy):
    aliases.https_alias(origin)
    host = urlsplit(origin).hostname.removeprefix("www.")
    public = [f"https://{host}", f"https://www.{host}"]
    return {**environment, "PUBLIC_ORIGIN": public[0], "PUBLIC_ALIAS_ORIGINS": "",
            "CADDY_SITE_ADDRESS": f"{host}, www.{host}, {legacy}",
            "CORS_ORIGINS": ",".join([legacy, *public])}


def sql_string(value):
    return "'" + str(value).replace("'", "''") + "'"


def query(controller, record, sql):
    command = aliases.compose(controller, record, "exec", "-T", "postgres", "psql", "-U",
                              controller.environment["POSTGRES_USER"], "-d", controller.environment["POSTGRES_DB"],
                              "-v", "ON_ERROR_STOP=1", "-At", "-c", sql)
    return controller.run("cutover-database", command)


def qr_rows(controller, record):
    return json.loads(query(controller, record,
        "SELECT coalesce(json_agg(json_build_object('id',trace_qr_id,'token',trace_token,'url',trace_url)),'[]'::json) FROM trace_qr"))


def fingerprint(controller, record):
    # URLs are deliberately changed; QR identity, tokens and every other field stay intact.
    tables = [("trace_event", "event_id", "to_jsonb(t)"), ("blockchain_proof", "event_id", "to_jsonb(t)"),
              ("trace_qr", "trace_qr_id", "to_jsonb(t)-'trace_url'")]
    sql = "SELECT json_build_object(" + ",".join(
        f"'{table}',(SELECT coalesce(json_object_agg({key}::text,md5(({projection})::text)),'{{}}'::json) FROM {table} t)"
        for table, key, projection in tables) + ")"
    return json.loads(query(controller, record, sql))


def rewrite_qr(controller, record, rows, origin, restore=False):
    statements = []
    for row in rows:
        aliases.require(re.fullmatch(r"[A-Za-z0-9_-]+", row["token"]), "Unexpected QR token")
        target = f"{origin}/trace/{row['token']}"
        old, new = (target, row["url"]) if restore else (row["url"], target)
        statements.append(f"UPDATE trace_qr SET trace_url={sql_string(new)} WHERE trace_qr_id={sql_string(row['id'])}::uuid AND trace_url={sql_string(old)};")
    query(controller, record, "BEGIN;" + "".join(statements) + "COMMIT;")


def protect_runtime(before, after, web_image):
    aliases.require(before.keys() == after.keys(), "The service set changed")
    targets = {"agri-trace-uat-api-1", "agri-trace-uat-web-1", "agri-trace-uat-proxy-1"}
    for name, row in before.items():
        expected = web_image if name == "agri-trace-uat-web-1" else row["image"]
        aliases.require(after[name]["image"] == expected, "Unexpected image change")
        aliases.require(name in targets or row["id"] == after[name]["id"], "A protected service was recreated")
        aliases.require(after[name]["status"] == "running" and after[name]["health"] in {None, "healthy"}, "Unhealthy service")


def model_guard(before, after):
    expected = copy.deepcopy(after)
    for name in before["services"]:
        # Build contexts move to exact archived Git bytes; runtime settings must match.
        if "build" in before["services"][name]:
            expected["services"][name]["build"] = before["services"][name]["build"]
    for key in ("CORS_ORIGIN", "PUBLIC_TRACE_BASE_URL"):
        expected["services"]["api"]["environment"][key] = before["services"]["api"]["environment"][key]
    expected["services"]["web"]["image"] = before["services"]["web"]["image"]
    expected["services"]["proxy"]["environment"]["CADDY_SITE_ADDRESS"] = before["services"]["proxy"]["environment"]["CADDY_SITE_ADDRESS"]
    for mount in expected["services"]["proxy"]["volumes"]:
        if mount["target"] == "/etc/caddy/Caddyfile":
            old_mount = next(value for value in before["services"]["proxy"]["volumes"] if value["target"] == mount["target"])
            mount["source"] = old_mount["source"]
    aliases.require(before == expected, "Cutover would change unrelated runtime settings")


def start(controller, record):
    for name in ("api", "web", "proxy"):
        controller.run("cutover-start-" + name, aliases.compose(controller, record, "up", "-d", "--no-deps", "--no-build",
                       "--pull", "never", "--wait", "--wait-timeout", "120", name), timeout=150)


def execute(args):
    base = Path(args.base).resolve(strict=True)
    os.umask(0o077)
    with aliases.delivery_lock(base):
        config_file = Path("/etc/agri-trace-cd/config.json")
        original_config = config_file.read_bytes()
        config = json.loads(original_config)
        controller = aliases.load_controller(config)
        state_file = controller.storage / "state.json"
        state_raw = state_file.read_bytes()
        state = json.loads(state_raw)
        aliases.require(state["current"] == args.expected_current, "Current release changed")
        previous = controller.record(state["current"])
        aliases.require(previous.get("verified") and re.fullmatch(r"[a-f0-9]{40}", args.source_sha), "Require verified current and exact source SHA")
        source = base / "releases" / ("uat-" + args.source_sha)
        aliases.require(source.is_dir(), "Archive exact reviewed source first")
        # These must be byte-identical to the deployed business code and signing policy.
        for directory in ("apps/api/src", "apps/api/prisma", "blockchain/gateway", "blockchain/chaincode/src"):
            old_root, new_root = Path(previous["directory"]) / directory, source / directory
            for old in old_root.rglob("*"):
                if old.is_file() and "node_modules" not in old.parts and "dist" not in old.parts:
                    relative = old.relative_to(old_root)
                    aliases.require((new_root / relative).is_file() and old.read_bytes() == (new_root / relative).read_bytes(), "Business source changed")
        aliases.require((source / "deploy/Caddyfile.uat").read_bytes() == (Path(previous["directory"]) / "deploy/Caddyfile.uat").read_bytes(), "Proxy policy changed")
        image = json.loads(controller.run("cutover-image", ["docker", "image", "inspect", args.web_image]))[0]
        labels = image["Config"].get("Labels", {})
        aliases.require(labels.get("org.opencontainers.image.revision") == args.source_sha and labels.get("agritrace.public-origin") == args.origin, "Web build provenance is invalid")
        target_environment = environment_for(controller.environment, args.origin, config["legacy_origin"])
        hostname = urlsplit(args.origin).hostname
        for host in (hostname, "www." + hostname):
            addresses = {row[4][0] for row in socket.getaddrinfo(host, 443)}
            aliases.require(addresses == {urlsplit(config["legacy_origin"]).hostname}, "New domain DNS is not this VPS")
        env_file = Path(config["env"])
        original_env = env_file.read_bytes()
        target = aliases.replace_environment(original_env, {key: target_environment[key] for key in
                    ("PUBLIC_ORIGIN", "PUBLIC_ALIAS_ORIGINS", "CADDY_SITE_ADDRESS", "CORS_ORIGINS")})
        record = copy.deepcopy(previous)
        record.update(id="uat-" + args.source_sha, sha=args.source_sha, directory=str(source), verified=False)
        record["manifest"].update(origin=args.origin, web=image["Id"])
        record["administration"] = {"operation": "origin-cutover", "applicationBaseSha": previous["sha"], "webSourceSha": args.source_sha}
        target_config = {**config, "origin": args.origin}
        before_model = json.loads(controller.run("cutover-before", aliases.compose(controller, previous, "--profile", "tools", "config", "--format", "json")))
        with tempfile.TemporaryDirectory(dir=controller.storage, prefix="cutover-plan-") as temporary:
            candidate_env = Path(temporary) / "environment"
            candidate_env.write_bytes(target)
            candidate = aliases.load_controller({**target_config, "env": str(candidate_env)})
            candidate.save_record(record)
            candidate.preflight(record)
            after_model = json.loads(candidate.run("cutover-after", aliases.compose(candidate, record, "--profile", "tools", "config", "--format", "json")))
            model_guard(before_model, after_model)
            candidate.run("cutover-caddy", ["docker", "exec", "-e", "CADDY_SITE_ADDRESS=" + target_environment["CADDY_SITE_ADDRESS"],
                          "agri-trace-uat-proxy-1", "caddy", "validate", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"])
        rows = qr_rows(controller, previous)
        summary = {"origin": args.origin, "previous": previous["id"], "candidate": record["id"], "qrCount": len(rows), "services": ["api", "web", "proxy"]}
        if not args.apply:
            print(json.dumps({"result": "plan", **summary}))
            return
        runtime_before, history_before = aliases.runtime(controller), fingerprint(controller, previous)
        backup = controller.storage / "origin-cutovers" / record["id"]
        backup.mkdir(mode=0o700, parents=True)
        for name, data in (("environment.before", original_env), ("config.before", original_config), ("state.before", state_raw),
                           ("qr.before.json", json.dumps(rows).encode())):
            aliases.atomic_write(backup / name, data)
        current_link = base / "current"
        original_link = os.readlink(current_link)
        switched = False
        try:
            aliases.atomic_write(env_file, target)
            aliases.atomic_write(config_file, json.dumps(target_config, indent=2).encode())
            active = aliases.load_controller(target_config)
            active.save_record(record)
            active.preflight(record)
            start(active, record)
            rewrite_qr(active, record, rows, args.origin)
            current_qrs = {row["id"]: row for row in qr_rows(active, record)}
            aliases.require(all(current_qrs[row["id"]]["url"] == f"{args.origin}/trace/{row['token']}" for row in rows), "QR URL migration did not complete")
            aliases.verify_public(target_environment)
            old_hosts = [urlsplit(config["origin"]).hostname, "www." + urlsplit(config["origin"]).hostname.removeprefix("www.")]
            for host in old_hosts:
                if host == hostname or host == "www." + hostname:
                    continue
                try:
                    urllib.request.urlopen("https://" + host + "/login", timeout=8)
                    raise ValueError("Retired domain is still accessible")
                except (urllib.error.URLError, OSError):
                    pass
            aliases.preserve_data(history_before, fingerprint(active, record))
            protect_runtime(runtime_before, aliases.runtime(active), image["Id"])
            evidence = active.verify(record)
            aliases.atomic_write(backup / "verification.json", json.dumps(evidence, indent=2).encode())
            record["verified"] = True
            active.save_record(record)
            aliases.require(state_file.read_bytes() == state_raw, "CD state changed during cutover")
            new_link = base / ".current-cutover"
            new_link.symlink_to(source)
            os.replace(new_link, current_link)
            switched = True
            aliases.atomic_write(state_file, json.dumps({**state, "current": record["id"], "previous": previous["id"]}, indent=2).encode())
            result = {"result": "passed", **summary, "roles": evidence.get("roles"), "verifiedQR": evidence.get("verifiedQR"),
                      "preserved": {key: len(value) for key, value in history_before.items()}, "backup": str(backup)}
            aliases.atomic_write(backup / "result.json", json.dumps(result, indent=2).encode())
            print(json.dumps(result))
        except BaseException:
            aliases.atomic_write(env_file, original_env)
            aliases.atomic_write(config_file, original_config)
            aliases.atomic_write(state_file, state_raw)
            if switched:
                rollback_link = base / ".current-cutover-rollback"
                rollback_link.symlink_to(original_link)
                os.replace(rollback_link, current_link)
            restored = aliases.load_controller(config)
            rewrite_qr(restored, previous, rows, args.origin, restore=True)
            start(restored, previous)
            aliases.verify_public(restored.environment)
            raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", default="/opt/agri-trace")
    for name in ("expected-current", "source-sha", "web-image", "origin"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--apply", action="store_true")
    def interrupted(*_):
        raise InterruptedError("Cutover interrupted")
    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, interrupted)
    execute(parser.parse_args())
