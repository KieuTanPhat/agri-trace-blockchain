"""Tune the owned local channel through a signed Fabric config update.

No ledger state is edited or reset. Original and updated channel config and the
signed update remain under the generation's private network root.
"""
import copy
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def main():
    root = Path(sys.argv[1]).resolve()
    instance = sys.argv[2]
    offset = int(sys.argv[3])
    repository = Path(__file__).resolve().parents[2]
    assert re.fullmatch(r'agritrace-local-[a-f0-9]{12}', instance)
    assert root == Path('/home/kieup/agritrace-fabric') / instance
    assert (root / '.agritrace-instance').read_text().strip() == instance
    os.umask(0o077)
    stage = root / 'channel-tuning'
    stage.mkdir(exist_ok=True)
    binary = root / 'fabric-samples/bin'
    net = root / 'net'
    peer_org = net / 'organizations/peerOrganizations/org1.example.com'
    orderer_org = net / 'organizations/ordererOrganizations/example.com'
    orderer_ca = orderer_org / 'orderers/orderer.example.com/tls/ca.crt'
    env = dict(os.environ, FABRIC_CFG_PATH=str(root / 'fabric-samples/config'),
               CORE_PEER_TLS_ENABLED='true', CORE_PEER_LOCALMSPID='AgritraceMSP',
               CORE_PEER_ADDRESS=f'localhost:{7051 + offset}',
               CORE_PEER_MSPCONFIGPATH=str(peer_org / 'users/Admin@org1.example.com/msp'),
               CORE_PEER_TLS_ROOTCERT_FILE=str(peer_org / 'peers/peer0.org1.example.com/tls/ca.crt'))

    def call(tool, args, override=None):
        result = subprocess.run([str(binary / tool), *map(str, args)], env=override or env,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if result.returncode:
            # The CA enrollment arguments can carry a credential: never print
            # arguments, stdout or stderr from that step.
            if tool != 'fabric-ca-client':
                (stage / 'diagnostic.log').write_bytes(result.stderr)
            raise RuntimeError(f'{tool} failed; inspect the private channel-tuning diagnostic')
        return result.stdout

    orderer_args = ['-o', f'localhost:{7050 + offset}', '--tls', '--cafile', orderer_ca]
    call('peer', ['channel', 'fetch', 'config', stage / 'block.pb', '-c', 'agritrace', *orderer_args])
    call('configtxlator', ['proto_decode', '--input', stage / 'block.pb', '--type', 'common.Block', '--output', stage / 'block.json'])
    config = json.loads((stage / 'block.json').read_text())['data']['data'][0]['payload']['data']['config']
    current = config['channel_group']['groups']['Orderer']['values']['BatchTimeout']['value']['timeout']
    if current == '100ms':
        print('Local channel BatchTimeout is already 100ms.')
        return
    updated = copy.deepcopy(config)
    updated['channel_group']['groups']['Orderer']['values']['BatchTimeout']['value']['timeout'] = '100ms'
    for name, value in [('original', config), ('updated', updated)]:
        (stage / f'{name}.json').write_text(json.dumps(value))
        call('configtxlator', ['proto_encode', '--input', stage / f'{name}.json', '--type', 'common.Config', '--output', stage / f'{name}.pb'])
    call('configtxlator', ['compute_update', '--channel_id', 'agritrace', '--original', stage / 'original.pb',
                          '--updated', stage / 'updated.pb', '--output', stage / 'update.pb'])
    call('configtxlator', ['proto_decode', '--input', stage / 'update.pb', '--type', 'common.ConfigUpdate', '--output', stage / 'update.json'])
    envelope = {'payload': {'header': {'channel_header': {'channel_id': 'agritrace', 'type': 2}},
                            'data': {'config_update': json.loads((stage / 'update.json').read_text())}}}
    (stage / 'envelope.json').write_text(json.dumps(envelope))
    call('configtxlator', ['proto_encode', '--input', stage / 'envelope.json', '--type', 'common.Envelope', '--output', stage / 'envelope.pb'])
    admin = orderer_org / 'users/ordereradmin/msp'
    if not (admin / 'signcerts/cert.pem').exists():
        script = (repository / 'blockchain/network/hybrid/hybrid-network.sh').read_text()
        secret = re.search(r'register ca-orderer "\$\{tls\}" ordereradmin (\S+) admin', script).group(1)
        call('fabric-ca-client', ['enroll', '-u', f'https://ordereradmin:{secret}@localhost:{9054 + offset}',
                                 '--caname', 'ca-orderer', '-M', admin, '--tls.certfiles', net / 'fabric-ca/orderer/ca-cert.pem'])
        shutil.copyfile(orderer_org / 'msp/config.yaml', admin / 'config.yaml')
    orderer_env = dict(env, CORE_PEER_LOCALMSPID='OrdererMSP', CORE_PEER_MSPCONFIGPATH=str(admin))
    call('peer', ['channel', 'signconfigtx', '-f', stage / 'envelope.pb'], orderer_env)
    call('peer', ['channel', 'update', '-f', stage / 'envelope.pb', '-c', 'agritrace', *orderer_args])
    print('Submitted signed local channel BatchTimeout update: ' + current + ' -> 100ms.')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
