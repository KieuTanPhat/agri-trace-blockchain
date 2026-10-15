import copy
import importlib.util
import unittest
from pathlib import Path

source = Path(__file__).parents[2] / 'blockchain/network/production/tcp-relay.py'
specification = importlib.util.spec_from_file_location('private_relay', source)
relay = importlib.util.module_from_spec(specification)
specification.loader.exec_module(relay)


class PrivateRelayAdmission(unittest.TestCase):
    def test_public_or_wildcard_binding_and_arbitrary_ports_are_rejected(self):
        valid = {'protocol': 'agritrace-private-relay/1', 'listen': '10.77.0.1', 'routes': {'7050': 29050, '7051': 29051}}
        relay.validate(valid)
        for patch in [{'listen': '0.0.0.0'}, {'listen': '8.8.8.8'}, {'listen': '127.0.0.1'},
                      {'routes': {'5432': 5432}}, {'routes': {'7050': 22}}, {'routes': {'7050': True}}, {'routes': {}}]:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                relay.validate(dict(copy.deepcopy(valid), **patch))


if __name__ == '__main__':
    unittest.main()
