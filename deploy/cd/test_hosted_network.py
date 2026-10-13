"""Admission checks before provisioning any owned Fabric resource."""
import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path

file = Path(__file__).parents[2] / 'blockchain/network/production/provision.py'
specification = importlib.util.spec_from_file_location('hosted_network', file)
network = importlib.util.module_from_spec(specification)
specification.loader.exec_module(network)


class HostedNetworkAdmission(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.spec = {'protocol': 'agritrace-hosted-network/1', 'instance': 'agritrace-rehearsal-test',
                     'root': str(self.root), 'bind': '127.0.0.1', 'port_offset': 30000,
                     'images': {name: name + '@sha256:' + 'a' * 64 for name in ['ca', 'peer', 'orderer', 'chaincode']},
                     'channels': {'hybrid-b': [1, 2], 'hybrid-self': [1, 3]}, 'writer_authority': 'agritrace-relayer-b',
                     'chaincode_fingerprint': 'b' * 64, 'governance_digest': 'c' * 64, 'tools_source': str(self.root / 'tools')}

    def test_mutable_image_or_public_administrative_port_is_rejected(self):
        network.validate(self.spec)
        for change in [dict(bind='0.0.0.0'), dict(port_offset=60000), dict(images=dict(self.spec['images'], peer='hyperledger/fabric-peer:latest'))]:
            with self.subTest(change=list(change)), self.assertRaises(RuntimeError):
                network.validate(dict(self.spec, **change))

    def test_production_cannot_reuse_a_test_root_or_unreviewed_channel_membership(self):
        for change in [dict(instance='agritrace-prod-test'), dict(channels={'hybrid-b': [1, 2, 3]}), dict(writer_authority='another-writer'), dict(root='/')]:
            with self.subTest(change=list(change)), self.assertRaises(RuntimeError):
                network.validate(dict(self.spec, **change))


if __name__ == '__main__':
    unittest.main()
