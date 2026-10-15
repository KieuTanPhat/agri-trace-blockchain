import copy
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from policy import CONTROLLER_FILES, PolicyError, ci_gate, extract, fingerprint, require, sha256, targets
from controller import Controller, PolicyError as ControllerError, policy as controller_policy


def binding():
    selected = targets.TARGETS['production']
    base = '/opt/agri-trace'
    root = base + '/hosted/production'
    hosted = dict(network='hosted_test', channel='hybrid-b', chaincode='agritrace', root=root,
                  containers=['peer0.org1.example.com', 'peer0.org2.example.com', 'orderer.example.com'],
                  volumes=['compose_peer0.org1.example.com', 'compose_peer0.org2.example.com', 'compose_orderer.example.com'],
                  backup_paths=[root + '/identities'], peer_binary=root + '/bin/peer', config_path=root + '/config',
                  orderer=dict(address='localhost:7050', hostname='orderer.example.com', tls=root + '/orderer/tls.crt'),
                  peers={str(i): dict(address=f'localhost:{7051 if i == 1 else 9051}', msp_id=f'Org{i}MSP',
                                     hostname=f'peer0.org{i}.example.com', msp=root + f'/org{i}/msp',
                                     tls=root + f'/org{i}/tls.crt') for i in [1, 2]})
    return dict(selected, schema=3, environment='production', enabled=False, profile='fabric', base=base,
                postgres_volume=selected['project'] + '_postgres-data', hosted=hosted,
                repository='KieuTanPhat/agri-trace-blockchain', host_lock='/run/lock/agri-trace-host.lock',
                env=base + '/shared/config/.env', accounts=base + '/shared/config/accounts.json',
                backup_certificate=base + '/shared/config/backup.pem', writes_mode='CLOSED', open_after_smoke=True,
                bootstrap=base + '/shared/config/bootstrap.json',
                smoke={'chainId': 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'farmId': '6bb639b5-924a-4e82-8d80-000000000201',
                       'plotId': '6bb639b5-924a-4e82-8d80-000000000203', 'productId': '6bb639b5-924a-4e82-8d80-000000000202'})


class TargetPolicy(unittest.TestCase):
    def test_only_production_main_binding_is_accepted(self):
        valid = binding()
        targets.validate_config(valid, require)
        for key, value in {'environment': 'development', 'branch': 'dev', 'origin': 'https://nongtrace.site',
                           'base': '/opt/agri-trace-dev', 'project': 'agritrace-dev',
                           'postgres_volume': 'agritrace-dev_postgres-data', 'ingress': 'agritrace-dev-ingress',
                           'env': '/opt/agri-trace-dev/shared/config/.env', 'enabled': 'true', 'schema': 1,
                           'host_lock': '/tmp/lock', 'accounts': '/opt/agri-trace/shared/../../other/accounts.json'}.items():
            with self.subTest(key=key), self.assertRaises(PolicyError):
                targets.validate_config(dict(valid, **{key: value}), require)

    def test_the_retired_uat_project_and_its_database_volume_are_rejected(self):
        retired = dict(binding(), project='agri-trace-uat', postgres_volume='agri-trace-uat_postgres-data')
        with self.assertRaisesRegex(PolicyError, 'project mismatch'):
            targets.validate_config(retired, require)
        for schema in (2, None):
            with self.subTest(schema=schema), self.assertRaises(PolicyError):
                targets.validate_config(dict(binding(), schema=schema), require)

    def test_fabric_is_required_and_retired_dev_resources_cannot_be_rebound(self):
        for change in [dict(profile='light'), dict(fabric_enabled=False), dict(hosted=None)]:
            with self.subTest(change=change), self.assertRaises(PolicyError):
                targets.validate_config(dict(binding(), **change), require)
        for key, value in [('root', '/opt/agri-trace-dev/fabric'), ('network', 'agritrace-dev-fabric'),
                           ('channel', 'agritrace-dev'), ('containers', ['agritrace-dev-peer1'])]:
            changed = copy.deepcopy(binding())
            changed['hosted'][key] = value
            with self.subTest(key=key), self.assertRaisesRegex(PolicyError, 'Retired development'):
                targets.validate_config(changed, require)

    def test_ci_evidence_from_dev_cannot_authorize_main_even_for_identical_sha(self):
        sha = 'a' * 40
        runs = [{'id': i, 'head_sha': sha, 'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success',
                 'path': '.github/workflows/' + name} for i, name in enumerate(('application-ci.yml', 'blockchain-ci.yml', 'dependency-audit.yml'))]
        ci_gate(runs, sha, sha, 'main')
        with self.assertRaises(PolicyError):
            ci_gate(runs, sha, sha, 'dev')
        with self.assertRaises(PolicyError):
            ci_gate([dict(run, head_branch='dev') for run in runs], sha, sha, 'main')

    def test_wrong_target_archive_is_rejected_before_extraction(self):
        target = binding()
        files = {name: b'services: {}' for name in targets.APP_FILES}
        files.update({'blockchain/chaincode/src/index.ts': b'export {}', 'blockchain/chaincode/dist/index.js': b'module.exports={}',
                      'apps/api/prisma/migrations/20260101_init/migration.sql': b'CREATE TABLE x (id INT);'})
        hashes = {k: sha256(v) for k, v in files.items()}
        manifest = {'format': 2, 'sha': 'a' * 40, 'repository': target['repository'], 'origin': target['origin'],
                    'files': hashes, 'chaincode': fingerprint(hashes), 'controller': {name: '0' * 64 for name in CONTROLLER_FILES},
                    'migrations': {'20260101_init': hashes['apps/api/prisma/migrations/20260101_init/migration.sql']},
                    'api': 'ghcr.io/kieutanphat/agri-trace-blockchain/api@sha256:' + 'b' * 64,
                    'web': 'ghcr.io/kieutanphat/agri-trace-blockchain/web@sha256:' + 'c' * 64,
                    **{k: target[k] for k in ('environment', 'branch', 'project', 'profile')}}
        for field, value in [(None, None), ('environment', 'development'), ('branch', 'dev'), ('project', 'agritrace-dev'),
                             ('origin', 'https://nongtrace.site'), ('format', 1), ('profile', 'light')]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                changed = dict(manifest)
                if field:
                    changed[field] = value
                contents = dict(files, **{'cd-manifest.json': json.dumps(changed).encode()})
                archive = Path(temporary) / 'release.tar.gz'
                with tarfile.open(archive, 'w:gz') as tar:
                    for name, data in contents.items():
                        member = tarfile.TarInfo(name)
                        member.size = len(data)
                        tar.addfile(member, io.BytesIO(data))
                destination = Path(temporary) / 'validated'
                if field:
                    with self.assertRaises(PolicyError):
                        extract(archive, destination, manifest['sha'], target['repository'], target['origin'], target)
                    self.assertFalse(destination.exists())
                else:
                    extract(archive, destination, manifest['sha'], target['repository'], target['origin'], target)
                    self.assertTrue(destination.exists())


class ProductionController(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.config = dict(binding(), base=str(root), env=str(root / '.env'), accounts=str(root / 'accounts.json'))
        (root / '.env').write_text('PUBLIC_ORIGIN=https://agritrace.dev\nCORS_ORIGINS=https://agritrace.dev\nPOSTGRES_USER=fixture\nPOSTGRES_DB=fixture\n')
        (root / 'accounts.json').write_text('[]')
        # Temporary paths are scoped to this fixture; binding validation is tested above.
        with patch.object(controller_policy.targets, 'validate_config', return_value=self.config):
            self.controller = Controller(self.config)

    def test_disabled_delivery_rejects_before_reading_transport(self):
        stream = io.BytesIO(b'never read')
        with self.assertRaisesRegex(ControllerError, 'disabled'):
            self.controller.execute(['deploy', 'a' * 40, 'b' * 64], stream)
        self.assertEqual(stream.tell(), 0)

    def test_rollback_requires_an_installed_release_before_transport_reads(self):
        self.config['enabled'] = True
        self.controller.state = lambda: {'current': None}
        stream = io.BytesIO(b'never read')
        with self.assertRaisesRegex(ControllerError, 'installed verified release'):
            self.controller.execute(['rollback', 'a' * 40], stream)
        self.assertEqual(stream.tell(), 0)


class HostedTargetBinding(unittest.TestCase):
    def test_external_owner_must_use_private_tls_and_cannot_retain_its_hosted_private_stack(self):
        config = binding()
        config['hosted']['external_owner'] = {'protocol': 'agritrace-external-owner/1', 'msp_id': 'Org3MSP',
            'channel': 'hybrid-self', 'endpoint': '10.77.0.2:11051', 'hostname': 'peer0.org3.example.com',
            'tls_ca': config['hosted']['root'] + '/public-owner/ca.crt'}
        targets.validate_config(config, require)
        for endpoint in ['0.0.0.0:11051', '8.8.8.8:11051', '10.77.0.2:5432']:
            changed = copy.deepcopy(config)
            changed['hosted']['external_owner']['endpoint'] = endpoint
            with self.subTest(endpoint=endpoint), self.assertRaises(PolicyError):
                targets.validate_config(changed, require)
        changed = copy.deepcopy(config)
        changed['hosted']['containers'].append('agritrace-prod-old-ca-org3')
        with self.assertRaisesRegex(PolicyError, 'retain a hosted'):
            targets.validate_config(changed, require)

    def test_target_has_its_own_database_mapping_and_never_binds_a_retained_network(self):
        config = binding()
        targets.validate_config(config, require)
        for change in [dict(fabric=binding()['hosted']), dict(project='agri-trace-uat', postgres_volume='agri-trace-uat_postgres-data'),
                       dict(writes_mode='CANARY'), dict(open_after_smoke='true'), dict(bootstrap='/tmp/bootstrap.json'),
                       dict(smoke={k: v for k, v in config['smoke'].items() if k != 'chainId'}),
                       dict(smoke=dict(config['smoke'], chainId='not-a-uuid'))]:
            with self.subTest(change=list(change)), self.assertRaises(PolicyError):
                targets.validate_config(dict(config, **change), require)


if __name__ == '__main__':
    unittest.main()
