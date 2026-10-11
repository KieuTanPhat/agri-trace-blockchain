"""Trusted environment bindings; release/SSH input cannot select a target."""
import re
from pathlib import PurePosixPath as Path

TARGETS = {
    "development": {"branch": "dev", "origin": "https://nongtrace.site", "prefix": "dev",
                    "project": "agritrace-dev", "ingress": "agritrace-dev-ingress"},
    "production": {"branch": "main", "origin": "https://agritrace.dev", "prefix": "prod",
                   "project": "agritrace-prod", "ingress": "agritrace-prod-ingress"},
}
APP_FILES = {"docker-compose.app.yml", "docker-compose.app-fabric.yml"}


def owned_path(value, root):
    path = Path(value)
    return path.is_absolute() and ".." not in path.parts and path.is_relative_to(Path(root))


def validate_target(value, require):
    require(isinstance(value, dict) and value.get("environment") in TARGETS, "Unknown deployment environment")
    selected = TARGETS[value["environment"]]
    for key in ("branch", "origin"):
        require(value.get(key) == selected[key], "Environment branch/origin mismatch")
    projects = {selected["project"]}
    if value["environment"] == "production":
        projects.add("agri-trace-uat")  # Adoption preserves the existing PGDATA.
    require(value.get("project") in projects, "Environment project mismatch")
    require(value.get("profile") in {"light", "fabric"}, "Unknown deployment profile")
    require(value["environment"] != "production" or value["profile"] == "fabric", "Production requires Fabric")
    return selected


def validate_config(config, require):
    selected = validate_target(config, require)
    require(config.get("schema") == 2 and type(config.get("enabled")) is bool, "Invalid installed target config")
    expected_base = "/opt/agri-trace-dev" if config["environment"] == "development" else "/opt/agri-trace"
    require(config.get("base") == expected_base, "Environment workspace mismatch")
    require(config.get("ingress") == selected["ingress"], "Environment ingress mismatch")
    require(config.get("postgres_volume") == config["project"] + "_postgres-data", "Database volume ownership mismatch")
    require(config.get("repository") == "KieuTanPhat/agri-trace-blockchain", "Unexpected deployment repository")
    require(config.get("host_lock") == "/run/lock/agri-trace-host.lock", "Host admission lock mismatch")
    root = Path(expected_base)
    for name in ("env", "accounts", "backup_certificate"):
        path = Path(config.get(name, ""))
        require(owned_path(path, root / "shared"), "Private config must belong to its environment")
    require(type(config.get("min_available_mib", 1536)) is int and config.get("min_available_mib", 1536) >= 1536,
            "Invalid memory admission threshold")
    aliases = config.get("legacy_cors_origins", [])
    require(isinstance(aliases, list) and set(aliases) <= ({"http://13.140.170.166"} if config["environment"] == "production" else set()),
            "Unapproved cross-environment CORS origin")
    fabric = config.get("fabric")
    if fabric:
        validate_fabric(config, require)
    if config["profile"] == "fabric":
        require(bool(fabric), "Fabric binding must be provisioned before activation")
    active = config.get("fabric_enabled", config["profile"] == "fabric")
    require(type(active) is bool and (config["environment"] != "production" or active), "Invalid Fabric runtime switch")
    require(not active or bool(fabric), "Fabric binding must be provisioned before activation")
    canary = config.get("canary")
    require(isinstance(canary, dict) and set(canary) == {"farmId", "plotId", "productId"}, "Dedicated canary catalog is required")
    require(all(isinstance(v, str) and re.fullmatch(r"[a-f0-9-]{36}", v) for v in canary.values()), "Invalid canary catalog IDs")
    return config


def validate_fabric(config, require):
    fabric = config["fabric"]
    require(isinstance(fabric, dict) and fabric.get("network") and fabric.get("channel") and fabric.get("chaincode"),
            "Incomplete Fabric binding")
    require(set(fabric.get("peers", {})) == {"1", "2"}, "Two reviewed endorsing peers are required")
    resources = fabric.get("containers", []) + fabric.get("volumes", [])
    require(bool(fabric.get("containers")) and bool(fabric.get("volumes")) and len(resources) == len(set(resources)),
            "Invalid Fabric resource catalog")
    require(all(isinstance(name, str) and re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,200}", name) for name in resources),
            "Invalid Fabric resource name")
    if config["environment"] == "development":
        require(fabric["network"] == "agritrace-dev-fabric", "Dev cannot use the production Fabric network")
        require(all(name.startswith("agritrace-dev-") for name in resources), "Dev Fabric resources must have dev ownership")
        require(owned_path(fabric["root"], Path(config["base"]) / "shared/fabric"), "Dev Fabric root ownership mismatch")
    require(Path(fabric["root"]).is_absolute(), "Fabric root must be absolute")
    require(bool(fabric.get("backup_paths")) and all(owned_path(p, fabric["root"])
            for p in fabric["backup_paths"]), "Fabric backup paths must belong to its root")
    for peer in fabric["peers"].values():
        require(all(peer.get(k) for k in ("address", "msp_id", "msp", "tls", "hostname")), "Incomplete peer binding")
    require(all(fabric.get("orderer", {}).get(k) for k in ("address", "hostname", "tls")), "Incomplete orderer binding")
    paths = [fabric.get("peer_binary", ""), fabric.get("config_path", ""), fabric["orderer"]["tls"]]
    paths += [peer[key] for peer in fabric["peers"].values() for key in ("msp", "tls")]
    require(all(owned_path(path, fabric["root"]) for path in paths), "Fabric admin paths must belong to its binding")
    return fabric
