#!/usr/bin/env python3
"""Prepare a narrowly scoped channel MSP rotation; never signs or submits it.

The enterprise supplies only public MSP material. The reviewed current channel
administrators must approve the resulting Fabric configuration transaction.
Historical blocks and identities are preserved; old roots cease to authorize
new actions after that configuration commits.
"""
import argparse
import base64
import copy
import hashlib
import ipaddress
import json
from pathlib import Path


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def rotate(config, enrollment_ca, tls_ca, endpoint):
    host, separator, port = endpoint.rpartition(':')
    if not separator or not port.isdecimal() or int(port) != 11051:
        raise ValueError('External owner must use its reviewed peer port')
    address = ipaddress.ip_address(host)
    if address.version != 4 or not address.is_private or address.is_loopback or address.is_unspecified:
        raise ValueError('External owner must use its reviewed private interface')
    for certificate in [enrollment_ca, tls_ca]:
        if not isinstance(certificate, bytes) or not 100 <= len(certificate) <= 32768 or b'PRIVATE KEY' in certificate:
            raise ValueError('Only public CA certificates are accepted')
        if not certificate.startswith(b'-----BEGIN CERTIFICATE-----') or b'-----END CERTIFICATE-----' not in certificate:
            raise ValueError('Public MSP material must contain PEM certificates')
    changed = copy.deepcopy(config)
    groups = changed['channel_group']['groups']['Application']['groups']
    if set(groups) != {'Org1MSP', 'Org3MSP'}:
        raise ValueError('Only the reviewed hybrid-self membership can be rotated')
    owner = groups['Org3MSP']
    msp = owner['values']['MSP']['value']['config']
    if msp['name'] != 'Org3MSP' or not msp.get('fabric_node_ous', {}).get('enable'):
        raise ValueError('Reviewed Org3 NodeOU authority is required')
    encode = lambda value: base64.b64encode(value).decode()
    msp.update(root_certs=[encode(enrollment_ca)], tls_root_certs=[encode(tls_ca)], admins=[],
               intermediate_certs=[], tls_intermediate_certs=[], revocation_list=[])
    for role in ['client', 'peer', 'admin', 'orderer']:
        msp['fabric_node_ous'][role + '_ou_identifier'] = {
            'certificate': encode(enrollment_ca), 'organizational_unit_identifier': role}
    anchor = owner['values'].setdefault('AnchorPeers', {'mod_policy': 'Admins', 'version': '0', 'value': {}})
    anchor['value'] = {'anchor_peers': [{'host': host, 'port': int(port)}]}
    review = {'protocol': 'agritrace-external-owner-rotation/1', 'mspId': 'Org3MSP', 'channelId': 'hybrid-self',
              'peerEndpoint': endpoint, 'beforeSha256': hashlib.sha256(canonical(config)).hexdigest(),
              'afterSha256': hashlib.sha256(canonical(changed)).hexdigest(),
              'enrollmentCaSha256': hashlib.sha256(enrollment_ca).hexdigest(), 'tlsCaSha256': hashlib.sha256(tls_ca).hexdigest()}
    return changed, review


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--public-msp', required=True)
    parser.add_argument('--endpoint', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    public = Path(args.public_msp)
    certificates = []
    for directory in ['cacerts', 'tlscacerts']:
        files = list((public / directory).glob('*'))
        if len(files) != 1 or not files[0].is_file():
            raise ValueError('Exactly one reviewed public CA per directory is required')
        certificates.append(files[0].read_bytes())
    changed, review = rotate(json.loads(Path(args.config).read_text()), *certificates, args.endpoint)
    output = Path(args.output)
    with output.open('x') as target:
        target.write(json.dumps(changed, indent=2) + '\n')
    with output.with_suffix('.review.json').open('x') as target:
        target.write(json.dumps(review, indent=2) + '\n')
    print(json.dumps(review))
