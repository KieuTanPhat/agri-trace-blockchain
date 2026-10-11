#!/usr/bin/env python3
"""Disposable Linux CI rehearsal of two app projects; never run on a live VPS."""
import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path


def run(*args, data=None):
    return subprocess.check_output(args, input=data, stderr=subprocess.PIPE, timeout=240)


def main():
    assert os.environ.get("GITHUB_ACTIONS") == "true", "This resettable rehearsal is only for disposable GitHub runners"
    root = Path(__file__).resolve().parents[2]
    prefix = "dual-ci-" + os.environ["GITHUB_RUN_ID"]
    projects = [prefix + "-prod", prefix + "-dev"]
    created = []
    with tempfile.TemporaryDirectory() as temporary:
        commands = {}
        try:
            for project in projects:
                ingress = project + "-ingress"
                run("docker", "network", "create", ingress)
                created.append(ingress)
                values = dict(API_IMAGE="agri-trace-ci-api", WEB_IMAGE="agri-trace-ci-web",
                    POSTGRES_IMAGE="postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873",
                    POSTGRES_DB="ci_test", POSTGRES_USER="ci_test", POSTGRES_PASSWORD="isolated-disposable-secret",
                    JWT_SECRET=project + "-isolated-ci-only-secret", IOT_INGEST_API_KEY=project,
                    PUBLIC_ORIGIN="https://nongtrace.site" if project.endswith("dev") else "https://agritrace.dev",
                    CORS_ORIGINS="https://nongtrace.site" if project.endswith("dev") else "https://agritrace.dev",
                    DEPLOY_ENV="development" if project.endswith("dev") else "production",
                    INGRESS_NETWORK=ingress, POSTGRES_VOLUME=project + "_postgres-data", UPSTREAM_PREFIX=project)
                env = Path(temporary) / (project + ".env")
                env.write_text("".join(k + "=" + v + "\n" for k, v in values.items()))
                commands[project] = ["docker", "compose", "-p", project, "--env-file", str(env), "-f", str(root / "docker-compose.app.yml")]
                dc = commands[project]
                model = json.loads(run(*dc, "config", "--format", "json"))
                assert all(not service.get("ports") for service in model["services"].values())
                assert "proxy" not in model["services"]
                run(*dc, "up", "-d", "--wait", "--wait-timeout", "120", "postgres")
                # A fresh volume must accept a query after --wait, before any migration.
                # Unix-socket readiness can catch initdb's temporary server during shutdown.
                ready = run(*dc, "exec", "-T", "-e", "PGPASSWORD=" + values["POSTGRES_PASSWORD"],
                    "postgres", "psql", "-h", "127.0.0.1", "-U", "ci_test", "-d", "ci_test", "-At", "-c",
                    "SELECT 1, to_regclass('public._prisma_migrations') IS NOT NULL")
                assert ready.strip() == b"1|f", "Fresh PostgreSQL was not ready before migration"
                run(*dc, "run", "--rm", "--no-deps", "migrate")
                run(*dc, "up", "-d", "--wait", "--wait-timeout", "180", "api", "web")
                run(*dc, "exec", "-T", "api", "node", "-e", "fetch('http://api:8080/api/health').then(r=>{if(!r.ok)process.exit(1)})")
                run(*dc, "exec", "-T", "web", "node", "-e", "fetch('http://api:8080/api/health').then(r=>{if(!r.ok)process.exit(1)})")
                running = json.loads(run("docker", "inspect", project + "-api-1"))[0]
                assert set(running["NetworkSettings"]["Networks"]) == {project + "_default", ingress}
                assert not subprocess.run(["docker", "inspect", project + "-worker-1"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            prod, dev = projects
            def sql(project, query):
                return run(*commands[project], "exec", "-T", "postgres", "psql", "-U", "ci_test", "-d", "ci_test", "-v", "ON_ERROR_STOP=1", "-At", "-c", query)
            for project in projects:
                sql(project, "CREATE TABLE ci_environment_marker (id text PRIMARY KEY); INSERT INTO ci_environment_marker VALUES ('" + project + "')")
            def baseline():
                containers = json.loads(run("docker", "inspect", *[prod + "-" + service + "-1" for service in ("api", "web", "postgres")]))
                return [(c["Id"], c["State"]["StartedAt"], c["RestartCount"]) for c in containers], hashlib.sha256(sql(prod, "SELECT id FROM ci_environment_marker")).hexdigest()
            before = baseline()
            dump = run(*commands[dev], "exec", "-T", "postgres", "pg_dump", "-U", "ci_test", "-d", "ci_test", "-Fc")
            run(*commands[dev], "exec", "-T", "postgres", "createdb", "-U", "ci_test", "ci_restore_test")
            run(*commands[dev], "exec", "-T", "postgres", "pg_restore", "-U", "ci_test", "-d", "ci_restore_test", "--no-owner", "--exit-on-error", data=dump)
            restored = run(*commands[dev], "exec", "-T", "postgres", "psql", "-U", "ci_test", "-d", "ci_restore_test", "-At", "-c", "SELECT id FROM ci_environment_marker")
            assert restored == sql(dev, "SELECT id FROM ci_environment_marker")
            run(*commands[dev], "down")  # Retire without deleting retained data.
            assert baseline() == before
            run("docker", "volume", "inspect", dev + "_postgres-data")
            run(*commands[dev], "up", "-d", "--wait", "--wait-timeout", "180", "postgres", "api", "web")
            assert sql(dev, "SELECT id FROM ci_environment_marker").strip().decode() == dev
            assert baseline() == before
            print(json.dumps({"result": "passed", "scenarios": ["cold-postgres-ready-before-migration", "separate-networks-databases", "light-without-worker", "backup-restore", "dev-retire-recreate", "prod-identities-data-unchanged"]}))
        finally:
            # Only these literal, run-scoped CI projects may be reset here.
            for dc in commands.values():
                subprocess.run([*dc, "down", "--volumes", "--remove-orphans"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for network in created:
                subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
