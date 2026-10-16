"""Constructors shared by controller tests.

The production controller accepts only the hosted schema-3 shape. Tests keep real file layouts out of
the way by building that shape under a temporary directory and bypassing only the host-path validation,
which test_targets.py exercises on its own.
"""
from pathlib import Path
from unittest.mock import patch


def hosted_config(base, env, **extra):
    base = Path(base)
    config = {
        "schema": 3, "environment": "production", "project": "agritrace-prod", "base": str(base), "env": str(env),
        "accounts": str(base / "accounts.json"), "ingress": "agritrace-prod-ingress",
        "postgres_volume": "agritrace-prod_postgres-data", "origin": "https://agritrace.dev", "branch": "main",
        "repository": "KieuTanPhat/agri-trace-blockchain", "backup_certificate": str(base / "shared/config/backup.pem"),
        "hosted": {"network": "hosted_test", "channel": "hybrid-b", "chaincode": "agritrace",
                   "containers": ["peer-a", "peer-b", "orderer-a"], "volumes": ["ledger-a", "ledger-b"],
                   "backup_paths": ["/opt/agri-trace/hosted/production/identities"], "peers": {}},
    }
    config.update(extra)
    return config


def build(cls, config):
    """Instantiate Controller (or a subclass) without validating host paths."""
    for klass in cls.__mro__:
        initializer = klass.__dict__.get("__init__")
        scope = getattr(initializer, "__globals__", {})
        if "policy" in scope and "Controller" in scope:
            policy = scope["policy"]
            break
    else:
        raise AssertionError("Controller class not found")
    with patch.object(policy.targets, "validate_config", return_value=config):
        return cls(config)
