"""Trusted environment bindings; release/SSH input cannot select a target."""
import re
from pathlib import PurePosixPath as Path

TARGETS = {
    "production": {"branch": "main", "origin": "https://agritrace.dev", "prefix": "prod",
                   "project": "agritrace-prod", "ingress": "agritrace-prod-ingress"},
}
APP_FILES = {"docker-compose.app.yml"}
OPTIONAL_APP_FILES = {"docker-compose.app-hybrid.yml"}


def owned_path(value, root):
    path = Path(value)
    return path.is_absolute() and ".." not in path.parts and path.is_relative_to(Path(root))


def validate_target(value, require):
    require(isinstance(value, dict) and value.get("environment") in TARGETS, "Unknown deployment environment")
    selected = TARGETS[value["environment"]]
    for key in ("branch", "origin"):
        require(value.get(key) == selected[key], "Environment branch/origin mismatch")
    require(value.get("project") == selected["project"], "Environment project mismatch")
    require(value.get("profile") == "fabric", "Production requires Fabric")
    return selected


def validate_config(config, require):
    selected = validate_target(config, require)
    require(config.get("schema") == 3 and type(config.get("enabled")) is bool, "Invalid installed target config")
    expected_base = "/opt/agri-trace"
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
    require(not config.get("fabric"), "Production must not bind a retained legacy network")
    hosted = config.get("hosted")
    require(isinstance(hosted, dict), "Hosted production network is required")
    validate_fabric(dict(config, fabric=hosted), require)
    require(owned_path(hosted["root"], root / "hosted"), "Hosted root must belong to production")
    require(config.get("writes_mode", "CLOSED") in {"CLOSED", "OPEN"}, "Production supports CLOSED or OPEN writes")
    require(type(config.get("open_after_smoke", False)) is bool, "Invalid post-smoke writer policy")
    require(owned_path(config.get("bootstrap", ""), root / "shared"), "Bootstrap must be private environment configuration")
    require(config["profile"] == "fabric" and config.get("fabric_enabled", True) is True, "Production requires active Fabric")
    smoke = config.get("smoke")
    require(isinstance(smoke, dict) and set(smoke) == {"chainId", "farmId", "plotId", "productId"}, "Dedicated verification catalog is required")
    require(all(isinstance(v, str) and re.fullmatch(r"[a-f0-9-]{36}", v) for v in smoke.values()), "Invalid smoke catalog IDs")
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
    require(Path(fabric["root"]).is_absolute(), "Fabric root must be absolute")
    require(not owned_path(fabric["root"], "/opt/agri-trace-dev") and
            fabric["network"] != "agritrace-dev-fabric" and fabric["channel"] != "agritrace-dev" and
            all(not name.startswith("agritrace-dev") for name in resources),
            "Retired development Fabric cannot serve production")
    require(bool(fabric.get("backup_paths")) and all(owned_path(p, fabric["root"])
            for p in fabric["backup_paths"]), "Fabric backup paths must belong to its root")
    owner = fabric.get("external_owner")
    if owner:
        require(isinstance(owner, dict) and owner.get("protocol") == "agritrace-external-owner/1" and
                owner.get("msp_id") == "Org3MSP" and owner.get("channel") == "hybrid-self" and
                owner.get("hostname") == "peer0.org3.example.com", "Unreviewed external owner")
        require(re.fullmatch(r"10\.77\.0\.2:11051", owner.get("endpoint", "")) and
                owned_path(owner.get("tls_ca", ""), fabric["root"]), "External owner must use reviewed private TLS routing")
        require(not any("-org3" in name or "org3.example.com" in name for name in fabric["containers"]),
                "External Org3 cannot retain a hosted peer, CA or chaincode")
    for peer in fabric["peers"].values():
        require(all(peer.get(k) for k in ("address", "msp_id", "msp", "tls", "hostname")), "Incomplete peer binding")
    require(all(fabric.get("orderer", {}).get(k) for k in ("address", "hostname", "tls")), "Incomplete orderer binding")
    paths = [fabric.get("peer_binary", ""), fabric.get("config_path", ""), fabric["orderer"]["tls"]]
    paths += [peer[key] for peer in fabric["peers"].values() for key in ("msp", "tls")]
    require(all(owned_path(path, fabric["root"]) for path in paths), "Fabric admin paths must belong to its binding")
    return fabric
