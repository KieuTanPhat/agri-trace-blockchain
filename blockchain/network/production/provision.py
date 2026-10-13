#!/usr/bin/env python3
"""Root/operator provisioning for one hosted Fabric network.

Inputs are private, root-owned configuration, never a CD release instruction.
All images are immutable. Each organization has a separate enrollment and TLS
CA, persistent CA state, MSP and ledger. No Docker socket is mounted in peers.
The operator owns all three technical organizations in this installation;
channel isolation does not establish independent external partner authority.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import ssl
import subprocess
import tarfile
import time
import urllib.request
from pathlib import Path


def require(value, message):
    if not value:
        raise RuntimeError(message)


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, sort_keys=True, indent=2) + '\n')
    temporary.chmod(0o600)
    with temporary.open('rb') as file:
        os.fsync(file.fileno())
    os.replace(temporary, path)


def validate(spec):
    require(spec.get('protocol') == 'agritrace-hosted-network/1', 'Unsupported network specification')
    require(re.fullmatch(r'agritrace-(prod|rehearsal)-[a-z0-9-]{3,40}', spec.get('instance', '')), 'Invalid owned network prefix')
    requested_root = Path(spec.get('root', ''))
    require(requested_root.is_absolute() and '..' not in requested_root.parts and not requested_root.is_symlink(), 'Unsafe network root')
    root = requested_root.resolve()
    require(root != Path('/') and root != Path.home(), 'Unsafe network root')
    require('-prod-' not in spec['instance'] or root.is_relative_to(Path('/opt/agri-trace/hosted')), 'Production root must belong to hosted storage')
    require(spec.get('bind', '127.0.0.1') == '127.0.0.1', 'Production administrative ports must be loopback only')
    offset = spec.get('port_offset', 0)
    require(type(offset) is int and 0 <= offset <= 50000, 'Invalid administrative port offset')
    for name in ['ca', 'peer', 'orderer', 'chaincode']:
        require(re.fullmatch(r'[^\s]+@sha256:[a-f0-9]{64}', spec.get('images', {}).get(name, '')), 'Every network image needs an immutable digest')
    require(spec.get('channels') == {'hybrid-b': [1, 2], 'hybrid-self': [1, 3]}, 'Unreviewed channel membership')
    require(spec.get('writer_authority') == 'agritrace-relayer-b', 'Unexpected technical writer authority')
    require(re.fullmatch(r'[a-f0-9]{64}', spec.get('chaincode_fingerprint', '')), 'Compiled source fingerprint is required')
    require(re.fullmatch(r'[a-f0-9]{64}', spec.get('governance_digest', '')), 'Governance digest is required')
    require(Path(spec.get('tools_source', '')).is_absolute(), 'Fabric CLI source is required')
    return spec


class Network:
    def __init__(self, spec):
        self.spec = validate(spec)
        self.root = Path(spec['root']).resolve()
        self.instance = spec['instance']
        self.net = self.instance + '-network'
        self.offset = spec.get('port_offset', 0)
        self.phase = 'initial'
        self.journal = self.root / 'provision-state.json'
        self.state = json.loads(self.journal.read_text()) if self.journal.exists() else {}
        self.images = spec['images']
        self.tools = self.root / 'fabric-samples'
        self.resources = []
        self.volumes = []

    def run(self, phase, args, env=None, timeout=240):
        self.phase = phase
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, timeout=timeout)
        with (self.root / 'private-operations.log').open('ab') as log:
            log.write((phase + ' exit=' + str(result.returncode) + '\n').encode())
            if result.returncode:
                log.write(result.stderr[:128 * 1024])
        require(result.returncode == 0, 'Network provisioning failed at ' + phase + '; inspect private operator diagnostics')
        return result.stdout

    def name(self, suffix):
        return self.instance + '-' + suffix

    def base(self, org):
        return self.root / ('self' if org == 'org3' else 'net')

    def orgdir(self, org):
        return self.base(org) / 'organizations' / 'peerOrganizations' / (org + '.example.com')

    def ca(self, org, tls=False):
        return self.base(org) / 'fabric-ca' / (('tls-' if tls else '') + org)

    def port(self, org, tls=False):
        return {'org1': 7054, 'org2': 8054, 'org3': 11054, 'orderer': 9054}[org] + self.offset + int(tls)

    def enroll(self, org, identity, destination, tls=False, hosts=(), profile=None):
        if (destination / 'signcerts/cert.pem').exists():
            return
        ca = self.ca(org, tls)
        secret = self.secrets[org][identity]
        args = [str(self.tools / 'bin/fabric-ca-client'), 'enroll', '-u',
                f'https://{identity}:{secret}@localhost:{self.port(org, tls)}', '--caname', ('tls-' if tls else '') + 'ca-' + org,
                '-M', str(destination), '--tls.certfiles', str(self.ca(org, True) / ('tls-cert.pem' if tls else 'ca-cert.pem'))]
        if profile:
            args += ['--enrollment.profile', profile]
        for host in hosts:
            args += ['--csr.hosts', host]
        if not tls or (self.ca(org, True) / 'operator-tls/signcerts/cert.pem').exists():
            args += self.client_tls(org)
        environment = dict(os.environ, FABRIC_CA_CLIENT_HOME=str(ca / 'client'))
        self.run('enroll-' + org + '-' + identity + ('-tls' if tls else ''), args, environment)

    def client_tls(self, org):
        material = self.ca(org, True) / 'operator-tls'
        return ['--tls.client.certfile', str(material / 'signcerts/cert.pem'),
                '--tls.client.keyfile', str(next((material / 'keystore').glob('*')))]

    def register(self, org, identity, kind, tls=False, attrs=None):
        # The same private secret is reused on recovery. A duplicate registration
        # is accepted only when the subsequent enrollment succeeds with it.
        admin = self.ca(org, tls) / 'admin'
        args = [str(self.tools / 'bin/fabric-ca-client'), 'register', '--caname', ('tls-' if tls else '') + 'ca-' + org,
                '--id.name', identity, '--id.secret', self.secrets[org][identity], '--id.type', kind,
                '-u', f'https://localhost:{self.port(org, tls)}', '--tls.certfiles', str(self.ca(org, True) / ('tls-cert.pem' if tls else 'ca-cert.pem'))]
        if attrs:
            args += ['--id.attrs', attrs]
        if not tls or (self.ca(org, True) / 'operator-tls/signcerts/cert.pem').exists():
            args += self.client_tls(org)
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=dict(os.environ, FABRIC_CA_CLIENT_HOME=str(admin)), timeout=45)
        if result.returncode:
            with (self.root / 'private-operations.log').open('ab') as log:
                log.write(result.stderr[:128 * 1024])
        require(result.returncode == 0 or b'is already registered' in result.stderr or b'is already registered' in result.stdout,
                'Identity registration failed at ' + org + '/' + identity)

    def container(self, suffix, component, args, memory, cpus='0.5'):
        name = self.name(suffix)
        self.resources.append(name)
        found = subprocess.run(['docker', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if found.returncode == 0:
            actual = json.loads(found.stdout)[0]
            require(actual['Config']['Labels'].get('agritrace.hosted.instance') == self.instance and
                    actual['Config']['Image'] == self.images[component], 'Existing hosted resource ownership/image differs')
            require(actual['HostConfig']['Memory'] == memory * 1024 * 1024 and actual['HostConfig']['NanoCpus'] > 0,
                    'Existing hosted resource quota differs')
            wanted_binds = sorted(args[index + 1] for index, arg in enumerate(args) if arg == '-v')
            require(sorted(actual['HostConfig'].get('Binds') or []) == wanted_binds, 'Existing hosted resource mounts differ; operator must reconcile the container')
            wanted_env = [args[index + 1] for index, arg in enumerate(args) if arg == '-e']
            require(all(value in actual['Config']['Env'] for value in wanted_env), 'Existing hosted resource environment differs')
            wanted_ports = {}
            for index, arg in enumerate(args):
                if arg == '-p':
                    host, port, private = args[index + 1].split(':')
                    wanted_ports[private + '/tcp'] = [{'HostIp': host, 'HostPort': port}]
            require((actual['HostConfig'].get('PortBindings') or {}) == wanted_ports, 'Hosted public port mapping differs')
            if not actual['State']['Running']:
                self.run('start-' + suffix, ['docker', 'start', name])
            return
        self.run('create-' + suffix, ['docker', 'run', '-d', '--name', name, '--hostname', suffix, '--network-alias', suffix,
                 '--network', self.net, '--restart', 'unless-stopped', '--label', 'agritrace.hosted.instance=' + self.instance,
                 '--label', 'agritrace.purpose=hosted-production', '--memory', str(memory) + 'm', '--memory-swap', str(memory) + 'm', '--cpus', cpus,
                 '--log-driver', 'json-file', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3', *args])

    def volume(self, suffix):
        name = self.name(suffix)
        self.volumes.append(name)
        result = subprocess.run(['docker', 'volume', 'inspect', name], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if result.returncode == 0:
            require(json.loads(result.stdout)[0]['Labels'].get('agritrace.hosted.instance') == self.instance, 'Ledger ownership mismatch')
        else:
            self.run('create-ledger-' + suffix, ['docker', 'volume', 'create', '--label', 'agritrace.hosted.instance=' + self.instance, name])
        return name

    def ca_server(self, org, tls=False):
        directory = self.ca(org, tls)
        config = directory / 'fabric-ca-server-config.json'
        if not config.exists():
            directory.mkdir(mode=0o700, parents=True)
            registry = {'identities': [{'name': 'admin', 'pass': self.secrets[org]['admin'], 'type': 'client', 'affiliation': '',
                        'attrs': {'hf.Registrar.Roles': '*', 'hf.Registrar.DelegateRoles': '*', 'hf.Revoker': True,
                                  'hf.IntermediateCA': True, 'hf.GenCRL': True, 'hf.Registrar.Attributes': '*', 'hf.AffiliationMgr': True}}]}
            transport = {'enabled': True}
            if not tls:
                material = self.ca(org, True) / 'ca-server-tls'
                transport.update(certfile=str(material / 'server.crt'), keyfile=str(material / 'server.key'),
                    clientauth={'type': 'RequireAndVerifyClientCert', 'certfiles': [str(self.ca(org, True) / 'ca-cert.pem')]})
            value = {'version': '1.5.22', 'port': self.port(org, tls) - self.offset, 'debug': False,
                     'ca': {'name': ('tls-' if tls else '') + 'ca-' + org}, 'tls': transport, 'registry': registry,
                     'csr': {'cn': ('tls-' if tls else '') + 'ca-' + org, 'hosts': ['localhost', 'ca-' + org], 'ca': {'expiry': '87600h'}},
                     'signing': {'default': {'expiry': '8760h'}, 'profiles': {'ca': {'usage': ['cert sign', 'crl sign'], 'expiry': '87600h',
                       'caconstraint': {'isca': True}}, 'tls': {'usage': ['signing', 'key encipherment', 'server auth', 'client auth'], 'expiry': '8760h'}}}}
            write_json(config, value)
        suffix = ('tls-' if tls else '') + 'ca-' + org
        # Same absolute paths inside the CA make issued TLS transport paths
        # unambiguous. No unrelated host configuration or Docker socket mounts.
        args = ['-p', f'127.0.0.1:{self.port(org,tls)}:{self.port(org,tls)-self.offset}',
                '-e', 'FABRIC_CA_SERVER_HOME=' + str(directory), '-v', f'{directory}:{directory}']
        if not tls:
            material = self.ca(org, True) / 'ca-server-tls'
            certificate = self.ca(org, True) / 'ca-cert.pem'
            args += ['-v', f'{material}:{material}:ro', '-v', f'{certificate}:{certificate}:ro']
        args += [self.images['ca'], 'fabric-ca-server', 'start', '-c', str(config)]
        self.container(suffix, 'ca', args, 96)
        rootcert = self.ca(org, True) / ('tls-cert.pem' if tls else 'ca-cert.pem')
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            if rootcert.exists():
                try:
                    context = ssl.create_default_context(cafile=str(rootcert))
                    if not tls or (self.ca(org, True) / 'operator-tls/signcerts/cert.pem').exists():
                        material = self.ca(org, True) / 'operator-tls'
                        context.load_cert_chain(str(material / 'signcerts/cert.pem'), str(next((material / 'keystore').glob('*'))))
                    request = urllib.request.Request(f'https://localhost:{self.port(org,tls)}/cainfo', data=b'{}', headers={'Content-Type': 'application/json'})
                    with urllib.request.urlopen(request, context=context, timeout=3) as response:
                        if response.status == 200:
                            return
                except Exception:
                    pass
            time.sleep(1)
        require(False, 'Certificate authority TLS readiness failed at ' + suffix)

    @staticmethod
    def collect_tls(material, root=None):
        shutil.copyfile(material / 'signcerts/cert.pem', material / 'server.crt')
        shutil.copyfile(next((material / 'keystore').glob('*')), material / 'server.key')
        shutil.copyfile(root or next((material / 'tlscacerts').glob('*')), material / 'ca.crt')

    @staticmethod
    def node_ou(msp):
        certificate = next((msp / 'cacerts').glob('*')).name
        (msp / 'config.yaml').write_text('NodeOUs:\n  Enable: true\n' + ''.join(
            f'  {name}OUIdentifier:\n    Certificate: cacerts/{certificate}\n    OrganizationalUnitIdentifier: {role}\n'
            for name, role in [('Client', 'client'), ('Peer', 'peer'), ('Admin', 'admin'), ('Orderer', 'orderer')]))

    def pki(self):
        for org in ['orderer', 'org1', 'org2', 'org3']:
            self.ca_server(org, tls=True)
            self.enroll(org, 'admin', self.ca(org, True) / 'admin/msp', tls=True)
            self.enroll(org, 'admin', self.ca(org, True) / 'operator-tls', tls=True, profile='tls', hosts=['localhost'])
            for identity, kind in [('ca-server', 'client'), ('node', 'orderer' if org == 'orderer' else 'peer'), ('cc', 'client')]:
                self.register(org, identity, kind, tls=True)
            self.enroll(org, 'ca-server', self.ca(org, True) / 'ca-server-tls', tls=True, profile='tls', hosts=['localhost', 'ca-' + org])
            self.collect_tls(self.ca(org, True) / 'ca-server-tls')
            self.ca_server(org)
            self.enroll(org, 'admin', self.ca(org) / 'admin/msp')
            directory = (self.root / 'net/organizations/ordererOrganizations/example.com' if org == 'orderer' else self.orgdir(org))
            self.enroll(org, 'admin', directory / 'msp')
            self.node_ou(directory / 'msp')
            transport_root = self.ca(org, True) / 'ca-cert.pem'
            (directory / 'msp/tlscacerts').mkdir(exist_ok=True)
            shutil.copyfile(transport_root, directory / 'msp/tlscacerts/ca.crt')
            hostname = 'orderer.example.com' if org == 'orderer' else f'peer0.{org}.example.com'
            node = directory / ('orderers' if org == 'orderer' else 'peers') / hostname
            self.register(org, 'node', 'orderer' if org == 'orderer' else 'peer')
            self.register(org, 'orgadmin', 'admin', attrs='app.role=admin:ecert')
            self.enroll(org, 'node', node / 'msp', hosts=[hostname, 'localhost'])
            shutil.copyfile(directory / 'msp/config.yaml', node / 'msp/config.yaml')
            self.enroll(org, 'node', node / 'tls', tls=True, profile='tls', hosts=[hostname, 'localhost'])
            self.collect_tls(node / 'tls')
            self.enroll(org, 'orgadmin', directory / 'users' / ('Admin@' + ('example.com' if org == 'orderer' else org + '.example.com')) / 'msp')
            admin = directory / 'users' / ('Admin@' + ('example.com' if org == 'orderer' else org + '.example.com')) / 'msp'
            shutil.copyfile(directory / 'msp/config.yaml', admin / 'config.yaml')
            if org == 'org1':
                for identity, attrs in [('relayer', 'app.role=relayer:ecert,app.authority=' + self.spec['writer_authority'] + ':ecert'), ('controller', 'app.role=controller:ecert')]:
                    self.register(org, identity, 'client', attrs=attrs)
                    material = directory / 'users' / (identity + '@org1.example.com') / 'msp'
                    self.enroll(org, identity, material)
                    shutil.copyfile(directory / 'msp/config.yaml', material / 'config.yaml')
            if org != 'orderer':
                material = self.root / 'cc-tls' / org
                self.enroll(org, 'cc', material, tls=True, profile='tls', hosts=['cc-' + org])
                self.collect_tls(material)
                # The node image runs as UID 1000. Only its own TLS identity is exposed.
                for file in [material / 'server.crt', material / 'server.key', material / 'ca.crt']:
                    file.chmod(0o444 if file.name != 'server.key' else 0o400)
                    os.chown(file, 1000, 1000)
                material.chmod(0o755)
        public = self.root / 'net/public/org3.example.com/msp'
        if not public.exists():
            public.mkdir(parents=True)
            source = self.orgdir('org3') / 'msp'
            for name in ['cacerts', 'tlscacerts']:
                shutil.copytree(source / name, public / name)
            shutil.copyfile(source / 'config.yaml', public / 'config.yaml')
        for org in ['orderer', 'org1', 'org2', 'org3']:
            file = self.ca(org, True) / 'fabric-ca-server-config.json'
            config = json.loads(file.read_text())
            if config['tls'].get('clientauth', {}).get('type') != 'RequireAndVerifyClientCert':
                config['tls']['clientauth'] = {'type': 'RequireAndVerifyClientCert', 'certfiles': [str(self.ca(org, True) / 'ca-cert.pem')]}
                write_json(file, config)
                self.run('tls-ca-enable-mutual-auth-' + org, ['docker', 'restart', self.name('tls-ca-' + org)])

    def peer_env(self, org):
        return dict(os.environ, FABRIC_CFG_PATH=str(self.tools / 'config'), CORE_PEER_TLS_ENABLED='true',
                    CORE_PEER_LOCALMSPID=f'Org{org}MSP', CORE_PEER_ADDRESS=f'localhost:{self.peer_port(org)+self.offset}',
                    CORE_PEER_MSPCONFIGPATH=str(self.orgdir('org' + str(org)) / f'users/Admin@org{org}.example.com/msp'),
                    CORE_PEER_TLS_ROOTCERT_FILE=str(self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com/tls/ca.crt'))

    @staticmethod
    def peer_port(org):
        return {1: 7051, 2: 9051, 3: 11051}[org]

    def peer(self, org, *args):
        return self.run('peer-' + str(org) + '-' + args[0], [str(self.tools / 'bin/peer'), *args], self.peer_env(org), timeout=150)

    def nodes(self):
        directory = self.root / 'net/organizations/ordererOrganizations/example.com/orderers/orderer.example.com'
        args = ['-p', f'127.0.0.1:{7050+self.offset}:7050', '-p', f'127.0.0.1:{7053+self.offset}:7053']
        environment = {'FABRIC_LOGGING_SPEC': 'INFO', 'ORDERER_GENERAL_LISTENADDRESS': '0.0.0.0', 'ORDERER_GENERAL_LISTENPORT': '7050',
          'ORDERER_GENERAL_LOCALMSPID': 'OrdererMSP', 'ORDERER_GENERAL_LOCALMSPDIR': '/node/msp', 'ORDERER_GENERAL_TLS_ENABLED': 'true',
          'ORDERER_GENERAL_TLS_PRIVATEKEY': '/node/tls/server.key', 'ORDERER_GENERAL_TLS_CERTIFICATE': '/node/tls/server.crt',
          'ORDERER_GENERAL_TLS_ROOTCAS': '[/node/tls/ca.crt]', 'ORDERER_GENERAL_CLUSTER_CLIENTCERTIFICATE': '/node/tls/server.crt',
          'ORDERER_GENERAL_CLUSTER_CLIENTPRIVATEKEY': '/node/tls/server.key', 'ORDERER_GENERAL_CLUSTER_ROOTCAS': '[/node/tls/ca.crt]',
          'ORDERER_GENERAL_BOOTSTRAPMETHOD': 'none', 'ORDERER_CHANNELPARTICIPATION_ENABLED': 'true', 'ORDERER_ADMIN_TLS_ENABLED': 'true',
          'ORDERER_ADMIN_TLS_CERTIFICATE': '/node/tls/server.crt', 'ORDERER_ADMIN_TLS_PRIVATEKEY': '/node/tls/server.key',
          'ORDERER_ADMIN_TLS_CLIENTROOTCAS': '[/node/tls/ca.crt]', 'ORDERER_ADMIN_LISTENADDRESS': '0.0.0.0:7053'}
        args += [part for key, value in environment.items() for part in ['-e', key + '=' + value]]
        volume = self.volume('orderer-ledger')
        args += ['-v', f'{directory}:/node:ro', '-v', volume + ':/var/hyperledger/production/orderer', self.images['orderer'], 'orderer']
        self.container('orderer.example.com', 'orderer', args, 256)
        for org in [1, 2, 3]:
            port = self.peer_port(org)
            directory = self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com'
            environment = {'FABRIC_LOGGING_SPEC': 'INFO', 'CORE_PEER_TLS_ENABLED': 'true', 'CORE_PEER_PROFILE_ENABLED': 'false',
              'CORE_PEER_TLS_CERT_FILE': '/node/tls/server.crt', 'CORE_PEER_TLS_KEY_FILE': '/node/tls/server.key', 'CORE_PEER_TLS_ROOTCERT_FILE': '/node/tls/ca.crt',
              'CORE_PEER_MSPCONFIGPATH': '/node/msp', 'CORE_PEER_LOCALMSPID': f'Org{org}MSP', 'CORE_PEER_ID': f'peer0.org{org}.example.com',
              'CORE_PEER_ADDRESS': f'peer0.org{org}.example.com:{port}', 'CORE_PEER_LISTENADDRESS': f'0.0.0.0:{port}',
              'CORE_PEER_GOSSIP_BOOTSTRAP': f'peer0.org{org}.example.com:{port}', 'CORE_PEER_GOSSIP_EXTERNALENDPOINT': f'peer0.org{org}.example.com:{port}',
              'CHAINCODE_AS_A_SERVICE_BUILDER_CONFIG': '{"peername":"peer0org' + str(org) + '"}'}
            args = ['-p', f'127.0.0.1:{port+self.offset}:{port}'] + [part for key, value in environment.items() for part in ['-e', key + '=' + value]]
            args += ['-v', f'{directory}:/node:ro', '-v', self.volume(f'org{org}-ledger') + ':/var/hyperledger/production', self.images['peer'], 'peer', 'node', 'start']
            self.container(f'peer0.org{org}.example.com', 'peer', args, 448, '1')

    def channels(self):
        template = Path(__file__).parents[1] / 'hybrid/templates/configtx.yaml.tmpl'
        config = self.root / 'net/configtx'
        config.mkdir(exist_ok=True, parents=True)
        (config / 'configtx.yaml').write_text(template.read_text().replace('@NET@', str(self.root / 'net')).replace('@SELF@', str(self.root / 'self')))
        artifacts = self.root / 'net/channel-artifacts'
        artifacts.mkdir(exist_ok=True)
        orderer_tls = self.root / 'net/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls'
        for channel, members in self.spec['channels'].items():
            block = artifacts / (channel + '.block')
            if not block.exists():
                self.run('channel-genesis-' + channel, [str(self.tools / 'bin/configtxgen'), '-profile', 'HybridB' if channel == 'hybrid-b' else 'HybridSelf', '-channelID', channel, '-outputBlock', str(block)], dict(os.environ, FABRIC_CFG_PATH=str(config)))
            if channel not in self.state.get('channels', []):
                args = [str(self.tools / 'bin/osnadmin'), 'channel', 'join', '--channelID', channel, '--config-block', str(block), '-o', f'localhost:{7053+self.offset}',
                        '--ca-file', str(orderer_tls / 'ca.crt'), '--client-cert', str(orderer_tls / 'server.crt'), '--client-key', str(orderer_tls / 'server.key')]
                deadline = time.monotonic() + 90
                while True:
                    try:
                        output = self.run('orderer-channel-' + channel, args)
                        # osnadmin can return a JSON HTTP error with exit zero.
                        text = output.decode()
                        require('201' in text or 'already exists' in text, 'Orderer did not join channel')
                        break
                    except RuntimeError:
                        require(time.monotonic() < deadline, 'Orderer channel readiness timed out')
                        time.sleep(2)
                self.state.setdefault('channels', []).append(channel)
                write_json(self.journal, self.state)
            for org in members:
                present = self.peer(org, 'channel', 'list').decode().splitlines()[1:]
                if channel not in present:
                    self.peer(org, 'channel', 'join', '-b', str(block))
        for org in [1, 2, 3]:
            channels = self.peer(org, 'channel', 'list').decode().splitlines()[1:]
            require(set(channels) == {c for c, members in self.spec['channels'].items() if org in members}, 'Channel membership isolation differs')

    def chaincode(self):
        orderer_tls = self.root / 'net/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt'
        label = 'agritrace_2.0'
        package_ids = {}
        for org in [1, 2, 3]:
            directory = self.root / 'cc-package' / ('org' + str(org))
            directory.mkdir(parents=True, exist_ok=True)
            peer_tls = self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com/tls'
            transport = self.root / 'cc-tls' / ('org' + str(org))
            connection = {'address': f'cc-org{org}:9999', 'dial_timeout': '10s', 'tls_required': True, 'client_auth_required': True,
                          'root_cert': (transport / 'ca.crt').read_text(), 'client_cert': (peer_tls / 'server.crt').read_text(), 'client_key': (peer_tls / 'server.key').read_text()}
            package = directory / 'chaincode.tgz'
            if not package.exists():
                def archive(values):
                    buffer = io.BytesIO()
                    with tarfile.open(fileobj=buffer, mode='w:gz') as file:
                        for name, data in values.items():
                            node = tarfile.TarInfo(name); node.size = len(data); node.mode = 0o600
                            file.addfile(node, io.BytesIO(data))
                    return buffer.getvalue()
                package.write_bytes(archive({'metadata.json': json.dumps({'type': 'ccaas', 'label': label}).encode(),
                    'code.tar.gz': archive({'connection.json': json.dumps(connection).encode()})}))
            expected_id = self.peer(org, 'lifecycle', 'chaincode', 'calculatepackageid', str(package)).decode().strip()
            installed = json.loads(self.peer(org, 'lifecycle', 'chaincode', 'queryinstalled', '--output', 'json')).get('installed_chaincodes') or []
            if not any(node['package_id'] == expected_id for node in installed):
                self.peer(org, 'lifecycle', 'chaincode', 'install', str(package))
            package_ids[str(org)] = expected_id
            self.container('cc-org' + str(org), 'chaincode', ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
              '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-v', str(transport) + ':/tls:ro', self.images['chaincode'],
              'node', '/app/node_modules/fabric-shim/cli.js', 'server', '--chaincode-address', '0.0.0.0:9999', '--chaincode-id', expected_id,
              '--chaincode-tls-cert-file', '/tls/server.crt', '--chaincode-tls-key-file', '/tls/server.key', '--chaincode-tls-client-cacert-file', '/tls/ca.crt'], 192)
        for channel, members in self.spec['channels'].items():
            args = ['--channelID', channel, '--name', 'agritrace', '--version', '2.0', '--sequence', '1']
            orderer = ['-o', f'localhost:{7050+self.offset}', '--ordererTLSHostnameOverride', 'orderer.example.com', '--tls', '--cafile', str(orderer_tls)]
            query = ['lifecycle', 'chaincode', 'querycommitted', '--channelID', channel, '--name', 'agritrace', '--output', 'json']
            committed = subprocess.run([str(self.tools / 'bin/peer'), *query], env=self.peer_env(members[0]), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if committed.returncode == 0:
                definition = json.loads(committed.stdout)
                require(definition['sequence'] == 1 and definition['version'] == '2.0', 'Existing hosted definition differs')
            else:
                for org in members:
                    self.peer(org, 'lifecycle', 'chaincode', 'approveformyorg', *orderer, *args, '--package-id', package_ids[str(org)])
                peers = [part for org in members for part in ['--peerAddresses', f'localhost:{self.peer_port(org)+self.offset}', '--tlsRootCertFiles', str(self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com/tls/ca.crt')]]
                self.peer(members[0], 'lifecycle', 'chaincode', 'commit', *orderer, *args, *peers)
                self.state.setdefault('chaincode', []).append(channel)
                write_json(self.journal, self.state)
            for org in members:
                definition = json.loads(self.peer(org, 'lifecycle', 'chaincode', 'querycommitted', '--channelID', channel, '--name', 'agritrace', '--output', 'json'))
                require(definition['sequence'] == 1 and definition['version'] == '2.0', 'Committed chaincode definition differs')

    def export(self):
        worker = self.root / 'worker-identities'
        worker.mkdir(exist_ok=True)
        for identity, name in [('relayer', 'relayer'), ('controller', 'controller'), ('Admin', 'admin')]:
            source = self.orgdir('org1') / f'users/{identity}@org1.example.com/msp'
            destination = worker / name
            if not destination.exists():
                destination.mkdir()
                for child in ['signcerts', 'keystore']:
                    shutil.copytree(source / child, destination / child)
        tls = worker / 'tls'; tls.mkdir(exist_ok=True)
        for org in [1, 2, 3]:
            shutil.copyfile(self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com/tls/ca.crt', tls / f'org{org}.crt')
        for path in [worker, *worker.rglob('*')]:
            os.chown(path, 1000, 1000)
            path.chmod(0o750 if path.is_dir() else 0o440)
        # Worker export contains no owner/admin2, Org3, CA or orderer key.
        peers = {str(org): {'address': f'localhost:{self.peer_port(org)+self.offset}', 'hostname': f'peer0.org{org}.example.com', 'msp_id': f'Org{org}MSP',
          'msp': str(self.orgdir('org' + str(org)) / f'users/Admin@org{org}.example.com/msp'),
          'tls': str(self.orgdir('org' + str(org)) / f'peers/peer0.org{org}.example.com/tls/ca.crt')} for org in [1, 2]}
        descriptor = {'network': self.net, 'root': str(self.root), 'channel': 'hybrid-b', 'chaincode': 'agritrace',
          'containers': self.resources, 'volumes': self.volumes, 'images': {name: self.images['ca' if '-ca-' in name else 'chaincode' if '-cc-' in name else 'orderer' if name.endswith('orderer.example.com') else 'peer'] for name in self.resources},
          'peer_binary': str(self.tools / 'bin/peer'), 'config_path': str(self.tools / 'config'), 'backup_paths': [str(self.root)], 'peers': peers,
          'orderer': {'address': f'localhost:{7050+self.offset}', 'hostname': 'orderer.example.com', 'tls': str(self.root / 'net/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/ca.crt')},
          'governance_digest': self.spec['governance_digest'], 'chaincode_fingerprint': self.spec['chaincode_fingerprint'], 'channels': self.spec['channels'],
          'externalPartnerAuthority': 'NotEvaluated', 'highAvailability': False}
        write_json(self.root / 'hosted-descriptor.json', descriptor)

    def provision(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        digest = hashlib.sha256(json.dumps(self.spec, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        marker = self.root / '.owned-network.json'
        if marker.exists():
            require(json.loads(marker.read_text()) == {'instance': self.instance, 'spec_sha256': digest}, 'Owned network specification changed; no resources were reset')
        else:
            require(not any((self.root / name).exists() for name in ['net', 'self', 'cc-package']), 'Existing unowned network root')
            write_json(marker, {'instance': self.instance, 'spec_sha256': digest})
        self.root.chmod(0o700)
        secret_file = self.root / 'enrollment-secrets.json'
        if not secret_file.exists():
            write_json(secret_file, {org: {identity: secrets.token_hex(24) for identity in ['admin', 'ca-server', 'node', 'cc', 'orgadmin', 'relayer', 'controller']}
                                    for org in ['orderer', 'org1', 'org2', 'org3']})
        self.secrets = json.loads(secret_file.read_text())
        if not self.tools.exists():
            self.tools.mkdir()
            for name in ['bin', 'config']:
                shutil.copytree(Path(self.spec['tools_source']) / name, self.tools / name)
        require('Version: v2.5.16' in self.run('peer-cli-version', [str(self.tools / 'bin/peer'), 'version']).decode(), 'Unsupported Fabric peer CLI revision')
        require('Version: v1.5.22' in self.run('ca-cli-version', [str(self.tools / 'bin/fabric-ca-client'), 'version']).decode(), 'Unsupported Fabric CA CLI revision')
        for image in self.images.values():
            self.run('pinned-image-pull', ['docker', 'pull', image], timeout=600)
        metadata = json.loads(self.run('chaincode-image-source', ['docker', 'inspect', self.images['chaincode']]))[0]
        require(metadata['Config'].get('Labels', {}).get('agritrace.chaincode-fingerprint') == self.spec['chaincode_fingerprint'], 'Immutable chaincode source fingerprint differs')
        present = subprocess.run(['docker', 'network', 'inspect', self.net], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        if present.returncode == 0:
            require(json.loads(present.stdout)[0]['Labels'].get('agritrace.hosted.instance') == self.instance, 'Network ownership mismatch')
        else:
            self.run('create-private-network', ['docker', 'network', 'create', '--label', 'agritrace.hosted.instance=' + self.instance, self.net])
        self.pki(); self.nodes(); self.channels(); self.chaincode(); self.export()
        self.state['completed'] = True; write_json(self.journal, self.state)
        return {'result': 'passed', 'instance': self.instance, 'channels': self.spec['channels'], 'containers': len(self.resources), 'ledgerVolumes': len(self.volumes)}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--spec', required=True)
    args = parser.parse_args()
    require(os.getuid() == 0, 'Provision hosted identities as a root operator')
    os.umask(0o077)
    spec = validate(json.loads(Path(args.spec).read_text()))
    root = Path(spec['root']); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    import fcntl
    with (root / 'operator.lock').open('a') as file:
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(json.dumps(Network(spec).provision()))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'result': 'failed', 'message': str(error) if isinstance(error, RuntimeError) else 'Private operator diagnostics require review; resources were preserved'}))
        raise SystemExit(1)
