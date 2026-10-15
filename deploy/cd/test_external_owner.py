import copy
import importlib.util
import unittest
from pathlib import Path

source = Path(__file__).parents[2] / 'blockchain/network/production/external-owner.py'
specification = importlib.util.spec_from_file_location('external_owner', source)
owner = importlib.util.module_from_spec(specification)
specification.loader.exec_module(owner)


class ExternalOwnerReview(unittest.TestCase):
    def setUp(self):
        organization = {'policies': {'Admins': 'unchanged'}, 'values': {
            'MSP': {'version': '0', 'mod_policy': 'Admins', 'value': {'config': {
                'name': 'Org3MSP', 'fabric_node_ous': {'enable': True},
                'root_certs': ['old'], 'tls_root_certs': ['old-tls']}}}}}
        self.config = {'sequence': '1', 'channel_group': {'groups': {
            'Orderer': {'unchanged': True}, 'Application': {'groups': {
                'Org1MSP': {'unchanged': True}, 'Org3MSP': organization}}}}}
        self.certificate = b'-----BEGIN CERTIFICATE-----\n' + b'A' * 100 + b'\n-----END CERTIFICATE-----\n'

    def test_rotation_only_changes_reviewed_owner_msp_and_anchor_and_preserves_original(self):
        before = copy.deepcopy(self.config)
        changed, review = owner.rotate(self.config, self.certificate, self.certificate, '10.77.0.2:11051')
        self.assertEqual(self.config, before)
        self.assertEqual(changed['channel_group']['groups']['Orderer'], before['channel_group']['groups']['Orderer'])
        application = changed['channel_group']['groups']['Application']['groups']
        self.assertEqual(application['Org1MSP'], before['channel_group']['groups']['Application']['groups']['Org1MSP'])
        self.assertEqual(application['Org3MSP']['policies'], {'Admins': 'unchanged'})
        self.assertEqual(application['Org3MSP']['values']['MSP']['version'], '0')
        self.assertNotEqual(review['beforeSha256'], review['afterSha256'])
        for invalid in ['0.0.0.0:11051', '127.0.0.1:11051', '8.8.8.8:11051', '10.77.0.2:7050']:
            with self.subTest(endpoint=invalid), self.assertRaises(ValueError):
                owner.rotate(self.config, self.certificate, self.certificate, invalid)

    def test_a_different_channel_membership_or_private_key_cannot_be_rotated(self):
        self.config['channel_group']['groups']['Application']['groups']['Org2MSP'] = {}
        with self.assertRaises(ValueError):
            owner.rotate(self.config, self.certificate, self.certificate, '10.77.0.2:11051')
        with self.assertRaises(ValueError):
            owner.rotate(self.config, b'PRIVATE KEY', self.certificate, '10.77.0.2:11051')


if __name__ == '__main__':
    unittest.main()
