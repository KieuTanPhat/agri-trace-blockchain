import copy
import importlib.util
import tempfile
import unittest
from pathlib import Path, PurePosixPath
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("fabric_dev", Path(__file__).parent.parent / "fabric-dev.py")
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


def model(root):
    services = {}
    for name in dev.HOSTS.values():
        peer = "peer" in name
        services[name] = {"container_name": name, "image": "hyperledger/fabric-peer:2.5.16" if peer else
                          "hyperledger/fabric-ca:1.5.22" if "ca" in name else "hyperledger/fabric-orderer:2.5.16",
                          "mem_limit": 128 * 1048576, "cpus": 1, "networks": {"test": {}},
                          "environment": {"CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE": "agritrace-dev-fabric", "CORE_VM_DOCKER_HOSTCONFIG_MEMORY": "536870912"},
                          "volumes": [{"type": "bind", "source": str(root / "own-msp"), "target": "/etc/hyperledger/fabric"},
                                      {"type": "bind", "source": str(root / "own-state"), "target": "/var/hyperledger"}]}
    services["agritrace-dev-peer1"]["ports"] = [{"host_ip": "127.0.0.1", "published": str(p)} for p in list(dev.PORTS.values())[:13]]
    return {"services": services, "networks": {"test": {"name": "agritrace-dev-fabric"}},
            "volumes": {str(n): {"name": name} for n, name in enumerate(["agritrace-dev-ledger-orderer", "agritrace-dev-ledger-peer1", "agritrace-dev-ledger-peer2"])}}


class IsolatedDevFabric(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.patch = patch.object(dev, "ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_rejects_public_port_production_network_volume_mount_and_unlimited_runtime(self):
        accepted = model(self.root)
        dev.validate_model(accepted)
        mutations = [
            lambda m: m["services"]["agritrace-dev-peer1"]["ports"][0].update(host_ip="0.0.0.0"),
            lambda m: m["services"]["agritrace-dev-peer1"]["ports"][0].update(published="7051"),
            lambda m: m["networks"]["test"].update(name="fabric_test"),
            lambda m: m["volumes"]["0"].update(name="compose_orderer.example.com"),
            lambda m: m["services"]["agritrace-dev-peer1"]["volumes"][0].update(source="/opt/agri-trace/private-msp"),
            lambda m: m["services"]["agritrace-dev-peer1"].update(mem_limit=0),
            lambda m: m["services"]["agritrace-dev-peer1"].update(image="hyperledger/fabric-peer:latest"),
            lambda m: m["services"]["agritrace-dev-peer1"]["environment"].update(CORE_VM_DOCKER_HOSTCONFIG_NETWORKMODE="fabric_test"),
            lambda m: m["services"]["agritrace-dev-peer1"]["volumes"].pop(),
        ]
        for mutate in mutations:
            with self.subTest(mutate=mutate), self.assertRaises(dev.policy.PolicyError):
                changed = copy.deepcopy(accepted)
                mutate(changed)
                dev.validate_model(changed)

    @unittest.skipIf(__import__("os").name == "nt", "Symlink fixture requires Linux privileges")
    def test_symlink_cannot_hide_cross_environment_mount(self):
        with tempfile.TemporaryDirectory() as other:
            link = self.root / "own-msp"
            link.symlink_to(other, target_is_directory=True)
            with self.assertRaisesRegex(dev.policy.PolicyError, "mount"):
                dev.validate_model(model(self.root))

    def test_upstream_dynamic_hostnames_and_ports_are_isolated(self):
        text = 'peer0.org${ORG}.example.com peer0.org1.example.com orderer.example.com fabric_test 7051:7051 17054:17054 hyperledger/fabric-ca:latest org1adminpw adminpw'
        changed = dev.transform(text, {"org1adminpw": "org-secret", "adminpw": "ca-secret"})
        self.assertEqual(changed, 'agritrace-dev-peer${ORG} agritrace-dev-peer1 agritrace-dev-orderer agritrace-dev-fabric 27051:27051 37054:37054 hyperledger/fabric-ca:1.5.22 org-secret ca-secret')

    def test_compose_bare_and_quoted_ports_bind_only_loopback(self):
        text = 'ports:\n  - 7051:7051\n  - "17054:17054"\nnetworks:\n  - test\n'
        changed = dev.transform(text, {})
        self.assertEqual(changed, 'ports:\n  - "127.0.0.1:27051:27051"\n  - "127.0.0.1:37054:37054"\nnetworks:\n  - test\n')

    def test_orderer_loop_uses_same_isolated_hostname_as_raft_compose(self):
        text = 'for ORDERER in orderer orderer2 orderer3 orderer4; do\n/organizations/orderers/${ORDERER}.example.com/tls --csr.hosts ${ORDERER}.example.com\norderer.example.com:7050'
        self.assertEqual(dev.transform(text, {}), 'for ORDERER in orderer; do\n/organizations/orderers/agritrace-dev-${ORDERER}/tls --csr.hosts agritrace-dev-${ORDERER}\nagritrace-dev-orderer:27050')

    def test_descriptor_is_accepted_by_existing_target_policy(self):
        with patch.object(dev, "ROOT", PurePosixPath("/opt/agri-trace-dev/shared/fabric")):
            binding = dev.descriptor()
            dev.policy.targets.validate_fabric({"environment": "development", "base": "/opt/agri-trace-dev", "fabric": binding}, dev.policy.require)
            self.assertTrue(all(n.startswith("agritrace-dev-") for n in binding["containers"] + binding["volumes"]))
            self.assertTrue(all(p["address"].startswith("localhost:") for p in binding["peers"].values()))

    def test_existing_resource_blocks_without_any_cleanup(self):
        calls = []
        def inspect(args, **kwargs):
            calls.append(args)
            return type("Result", (), {"returncode": 0})()
        with patch.object(dev.subprocess, "run", side_effect=inspect), self.assertRaisesRegex(dev.policy.PolicyError, "already exists"):
            dev.absent_resources()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][:3], ["docker", "container", "inspect"])


if __name__ == "__main__":
    unittest.main()
