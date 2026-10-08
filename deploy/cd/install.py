#!/usr/bin/env python3
"""One-time/reviewed administrator install. Never called by the CD SSH key."""
import argparse
import datetime
import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path

spec = importlib.util.spec_from_file_location("cd_controller", Path(__file__).with_name("controller.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
Controller, atomic_json, policy = module.Controller, module.atomic_json, module.policy


def install(args):
    policy.require(os.getuid() == 0, "Run the reviewed installer as administrator")
    os.umask(0o077)
    base = Path(args.base).resolve()
    current = (base / "current").resolve(strict=True)
    policy.require(current.is_relative_to(base / "releases"), "Current release is outside the workspace")
    source = Path(__file__).parent
    installed = Path("/usr/local/lib/agri-trace-cd")
    installed.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name in ("controller.py", "policy.py", "verify.mjs", "entry"):
        shutil.copyfile(source / name, installed / name)
        (installed / name).chmod(0o755 if name == "entry" else 0o644)
        os.chown(installed / name, 0, 0)
    private = Path("/etc/agri-trace-cd")
    private.mkdir(mode=0o700, exist_ok=True)
    config_file = private / "config.json"
    if not config_file.exists():
        shared = base / "shared/config"
        shared.mkdir(mode=0o700, parents=True, exist_ok=True)
        environment = policy.read_env(current / ".uat/.env.uat")
        account_source = Path(environment["UAT_ACCOUNTS_FILE"])
        if not account_source.is_absolute():
            account_source = current / account_source
        shutil.copyfile(account_source, shared / "accounts.json")
        environment["UAT_ACCOUNTS_FILE"] = str(shared / "accounts.json")
        for name in ("RELAYER_MSP_DIR_HOST", "FABRIC_TLS_CERT_HOST"):
            value = Path(environment[name])
            environment[name] = str((current / value).resolve() if not value.is_absolute() else value.resolve())
        (shared / ".env.uat").write_text("\n".join(f"{key}={value}" for key, value in environment.items()) + "\n")
        (shared / ".env.uat").chmod(0o600)
        (shared / "accounts.json").chmod(0o600)
        shutil.copyfile(args.certificate, private / "backup-recipient.pem")
        config = {"base": str(base), "env": str(shared / ".env.uat"), "accounts": str(shared / "accounts.json"),
                  "origin": environment["PUBLIC_ORIGIN"], "repository": args.repository,
                  "network_root": str(current), "backup_certificate": str(private / "backup-recipient.pem")}
        atomic_json(config_file, config)
    else:
        config = json.loads(config_file.read_text())
        policy.require(config["base"] == str(base) and config["repository"] == args.repository, "Installed deployment target differs")
    storage = base / "cd"
    storage.mkdir(mode=0o700, exist_ok=True)
    controller = Controller(config)
    if not (storage / "state.json").exists():
        initial_manifest = json.loads((current / "release-manifest.json").read_text())
        sha = initial_manifest["baseMainSha"]
        chaincode_root = current / "blockchain/chaincode"
        source_files = [file for file in (chaincode_root / "src").rglob("*") if file.is_file()]
        source_files += [chaincode_root / name for name in ("package.json", "package-lock.json", "tsconfig.json")]
        files = {file.relative_to(current).as_posix(): policy.sha256(file.read_bytes()) for file in source_files}
        migrations = {file.parent.name: policy.sha256(file.read_bytes()) for file in (current / "apps/api/prisma/migrations").glob("*/migration.sql")}
        ids = {}
        for name in ("api", "web"):
            ids[name] = subprocess.check_output(["docker", "inspect", "--format", "{{.Image}}", f"agri-trace-uat-{name}-1"], text=True).strip()
        record = {"id": "uat-" + sha, "sha": sha, "directory": str(current), "verified": True,
                  "manifest": {"api": ids["api"], "web": ids["web"], "chaincode": policy.fingerprint(files), "migrations": migrations},
                  "sourceSnapshot": initial_manifest}
        definition = controller.definition()
        packages = {}
        for org in (1, 2):
            approved = json.loads(controller.peer("initial-approved-package", org, "queryapproved", "--channelID", "agritrace", "--name", "agritrace", "--sequence", str(definition["sequence"]), "--output", "json"))
            packages[str(org)] = policy.approved_package(approved)
        chaincode = {"sequence": definition["sequence"], "version": definition["version"], "packages": packages, "fingerprint": record["manifest"]["chaincode"]}
        record["chaincode"] = chaincode
        controller.save_record(record)
        controller.preflight(record)
        evidence = controller.verify(record)
        atomic_json(storage / "adoption-evidence.json", evidence)
        atomic_json(storage / "state.json", {"current": record["id"], "previous": None, "chaincode": chaincode, "compatible_migrations": []})
    public_key = Path(args.public_key).read_text().strip()
    policy.require(public_key.startswith("ssh-ed25519 ") and "\n" not in public_key and '"' not in public_key, "Expected one CD public key")
    if subprocess.run(["id", "agri-cd"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        subprocess.run(["useradd", "--create-home", "--shell", "/bin/bash", "agri-cd"], check=True)
    subprocess.run(["passwd", "-l", "agri-cd"], check=True, stdout=subprocess.DEVNULL)
    ssh = Path("/home/agri-cd/.ssh")
    ssh.mkdir(mode=0o755, exist_ok=True)
    # umask077 is for secrets; this root-owned directory must be traversable
    # by sshd after it switches to the CD account to read the public key.
    ssh.chmod(0o755)
    os.chown(ssh, 0, 0)
    authorized = ssh / "authorized_keys"
    authorized.write_text('restrict,command="sudo -n /usr/local/lib/agri-trace-cd/entry \\\"$SSH_ORIGINAL_COMMAND\\\"" ' + public_key + "\n")
    authorized.chmod(0o644)
    os.chown(authorized, 0, 0)
    sudo = Path("/etc/sudoers.d/agri-trace-cd")
    sudo.write_text("agri-cd ALL=(root) NOPASSWD: /usr/local/lib/agri-trace-cd/entry\n")
    sudo.chmod(0o440)
    subprocess.run(["visudo", "-cf", str(sudo)], check=True, stdout=subprocess.DEVNULL)
    print(json.dumps({"result": "installed", "current": controller.state()["current"], "origin": config["origin"], "user": "agri-cd"}))


def update_origin(args):
    policy.require(os.getuid() == 0, "Run the origin update as administrator")
    os.umask(0o077)
    base = Path(args.base).resolve()
    private = Path("/etc/agri-trace-cd")
    config_file = private / "config.json"
    policy.require(config_file.is_file(), "CD controller is not installed")
    config = json.loads(config_file.read_text())
    policy.require(config["base"] == str(base) and config["repository"] == args.repository,
                    "Installed deployment target differs")
    environment_file = Path(config["env"])
    environment = policy.read_env(environment_file)
    policy.require(environment.get("PUBLIC_ORIGIN") == config["origin"],
                    "Installed origin and private environment differ; reconcile manually")
    policy.require(policy.valid_public_origin(args.update_origin), "Invalid public deployment origin")

    from urllib.parse import urlsplit
    parsed = urlsplit(args.update_origin)
    hostname = parsed.hostname
    legacy_origin = config.get("legacy_origin") or config["origin"]
    if parsed.scheme == "https":
        apex = hostname.removeprefix("www.")
        site_address = f"{apex},www.{apex},{legacy_origin}"
        http_port = "80"
    else:
        site_address = f"http://{hostname}"
        http_port = str(parsed.port or 80)

    cors_origins = environment.get("CORS_ORIGINS", environment.get("PUBLIC_ORIGIN", config["origin"])).split(",")
    for origin in (legacy_origin, config["origin"], args.update_origin):
        if origin not in cors_origins:
            cors_origins.append(origin)
    if parsed.scheme == "https":
        www_origin = f"https://www.{hostname.removeprefix('www.')}"
        if www_origin not in cors_origins:
            cors_origins.append(www_origin)
    config["legacy_origin"] = legacy_origin
    environment.update({
        "PUBLIC_ORIGIN": args.update_origin,
        "CADDY_SITE_ADDRESS": site_address,
        "CORS_ORIGINS": ",".join(cors_origins),
        "HTTP_PORT": http_port,
        "HTTPS_BIND": environment.get("HTTPS_BIND", "0.0.0.0"),
        "HTTPS_PORT": "443",
    })
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    env_backup = environment_file.with_name(environment_file.name + ".before-origin-" + stamp)
    config_backup = config_file.with_name(config_file.name + ".before-origin-" + stamp)
    policy.require(not env_backup.exists() and not config_backup.exists(), "Origin backup already exists")
    shutil.copyfile(environment_file, env_backup)
    shutil.copyfile(config_file, config_backup)
    env_backup.chmod(0o600)
    config_backup.chmod(0o600)
    os.chown(env_backup, 0, 0)
    os.chown(config_backup, 0, 0)

    env_temp = environment_file.with_name(environment_file.name + ".origin-tmp")
    config["origin"] = args.update_origin
    try:
        env_temp.write_text("\n".join(f"{key}={value}" for key, value in environment.items()) + "\n")
        env_temp.chmod(0o600)
        os.chown(env_temp, 0, 0)
        os.replace(env_temp, environment_file)
        atomic_json(config_file, config)
    except Exception:
        if env_temp.exists():
            env_temp.unlink()
        shutil.copyfile(env_backup, environment_file)
        environment_file.chmod(0o600)
        os.chown(environment_file, 0, 0)
        shutil.copyfile(config_backup, config_file)
        config_file.chmod(0o600)
        os.chown(config_file, 0, 0)
        raise

    installed = Path("/usr/local/lib/agri-trace-cd")
    installed.mkdir(mode=0o755, parents=True, exist_ok=True)
    for name in ("controller.py", "policy.py", "verify.mjs", "entry"):
        shutil.copyfile(Path(__file__).with_name(name), installed / name)
        (installed / name).chmod(0o755 if name == "entry" else 0o644)
        os.chown(installed / name, 0, 0)
    print(json.dumps({"result": "origin-updated", "origin": args.update_origin,
                      "backup": str(env_backup), "configBackup": str(config_backup)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="/opt/agri-trace")
    parser.add_argument("--repository", required=True)
    parser.add_argument("--public-key")
    parser.add_argument("--certificate")
    parser.add_argument("--update-origin")
    arguments = parser.parse_args()
    if arguments.update_origin:
        update_origin(arguments)
    else:
        policy.require(bool(arguments.public_key and arguments.certificate),
                       "Initial install requires --public-key and --certificate")
        install(arguments)
