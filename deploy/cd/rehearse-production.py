#!/usr/bin/env python3
"""Rehearse PostgreSQL retention/restore on a disposable CI runner, never a VPS.

This is a database gate. Blockchain CI and release verification separately
require real Fabric receipts; this rehearsal cannot waive those gates.
"""
import json
import os
import re
import subprocess


def run(*args, data=None):
    return subprocess.check_output(args, input=data, stderr=subprocess.PIPE, timeout=240)


def main():
    assert os.environ.get('GITHUB_ACTIONS') == 'true', 'Only disposable GitHub runners may run this rehearsal'
    identifier = os.environ['GITHUB_RUN_ID'] + '-' + os.environ['GITHUB_RUN_ATTEMPT']
    assert re.fullmatch(r'[0-9]+-[0-9]+', identifier)
    name = 'agritrace-prod-ci-' + identifier
    volume, network = name + '-postgres', name + '-network'
    created = []
    try:
        # Existing resources are never adopted or reset by a test.
        for kind, resource in [('container', name), ('volume', volume), ('network', network)]:
            assert subprocess.run(['docker', kind, 'inspect', resource], stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL).returncode != 0, 'CI resource already exists'
        for kind, resource in [('network', network), ('volume', volume)]:
            run('docker', kind, 'create', '--label', 'agritrace.ci-rehearsal=' + name, resource)
            created.append((kind, resource))
        run('docker', 'run', '-d', '--name', name, '--label', 'agritrace.ci-rehearsal=' + name,
            '--network', network, '--memory', '512m', '--cpus', '1',
            '-e', 'POSTGRES_USER=ci_test', '-e', 'POSTGRES_DB=ci_test', '-e', 'POSTGRES_PASSWORD=isolated-ci-only',
            '-v', volume + ':/var/lib/postgresql',
            '--health-cmd', 'pg_isready -h 127.0.0.1 -U ci_test -d ci_test', '--health-interval', '2s', '--health-retries', '60',
            'postgres:18-alpine@sha256:77f585114c32fbca283dc835b0596f4e52b51b4c6662d7810b2f4084f60a1873')
        created.append(('container', name))
        def ready():
            # The final TCP server is required rather than initdb's Unix socket.
            run('docker', 'exec', name, 'sh', '-ec',
                'i=0; until PGPASSWORD=isolated-ci-only psql -h 127.0.0.1 -U ci_test -d ci_test -At -c "SELECT 1"; do '
                'i=$((i+1)); test "$i" -lt 60; sleep 2; done')
        def sql(database, query):
            return run('docker', 'exec', name, 'psql', '-U', 'ci_test', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query)
        ready()
        assert sql('ci_test', "SELECT to_regclass('public._prisma_migrations') IS NULL").strip() == b't'
        sql('ci_test', "CREATE TABLE retained_marker(id text PRIMARY KEY); INSERT INTO retained_marker VALUES ('retained-production-fixture')")
        baseline = sql('ci_test', 'SELECT id FROM retained_marker ORDER BY id')
        dump = run('docker', 'exec', name, 'pg_dump', '-U', 'ci_test', '-d', 'ci_test', '-Fc')
        run('docker', 'exec', name, 'createdb', '-U', 'ci_test', 'ci_restore')
        run('docker', 'exec', '-i', name, 'pg_restore', '-U', 'ci_test', '-d', 'ci_restore', '--no-owner', '--exit-on-error', data=dump)
        assert sql('ci_restore', 'SELECT id FROM retained_marker ORDER BY id') == baseline
        run('docker', 'stop', '--time', '20', name)
        run('docker', 'start', name)
        ready()
        assert sql('ci_test', 'SELECT id FROM retained_marker ORDER BY id') == baseline
        print(json.dumps({'result': 'passed', 'scope': 'disposable-production-database',
                          'scenarios': ['cold-tcp-readiness', 'backup-restore', 'retained-data-after-restart']}))
    finally:
        for kind, resource in reversed(created):
            metadata = json.loads(run('docker', kind, 'inspect', resource))[0]
            labels = metadata['Config']['Labels'] if kind == 'container' else metadata['Labels']
            assert labels['agritrace.ci-rehearsal'] == name
            run('docker', kind, 'rm', *(['--force'] if kind == 'container' else []), resource)


if __name__ == '__main__':
    main()
