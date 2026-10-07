#!/usr/bin/env python3
"""Exercise the production migration command against the disposable CI stack."""
import argparse
import os
import sys
from pathlib import Path
from controller import Controller, require


class Probe(Controller):
    def dc(self, record, *args):
        return ["docker", "compose", "--project-name", "agri-trace-uat-ci",
                "--env-file", self.config["env"], "-f", str(self.config["compose"]), *args]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", required=True)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    environment = Path(args.env).resolve()
    require(environment.is_relative_to(repository / ".uat"), "CLI probe requires disposable CI configuration")
    require(os.environ.get("COMPOSE_PROJECT_NAME") == "agri-trace-uat-ci", "CLI probe requires the CI project name")
    probe = Probe({"base": str(environment.parent), "env": str(environment), "compose": repository / "docker-compose.uat.yml"})
    require(probe.environment["PUBLIC_ORIGIN"] == "http://127.0.0.1:18080", "CLI probe requires the CI loopback origin")
    probe.storage.mkdir(mode=0o700, exist_ok=True)
    probe.migrate({})
    print("Production controller migration command passed against disposable CI PostgreSQL")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("Controller migration CLI probe failed; private diagnostics are in the CI configuration directory", file=sys.stderr)
        sys.exit(1)
