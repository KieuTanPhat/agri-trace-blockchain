"""Admission boundaries for an explicitly discarded production generation."""
import copy
import json
import os
import tempfile
import unittest
from pathlib import Path

import policy
from cd_testing import build, hosted_config
from controller import Controller, PolicyError


@unittest.skipIf(os.name == 'nt', 'Production receipt ownership and permissions require POSIX')
class ReinstallationApproval(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.base = Path(temporary.name)
        env = self.base / 'settings'
        env.write_text('POSTGRES_USER=test\nPOSTGRES_DB=agri_trace_prod\n')
        self.cd = build(Controller, hosted_config(self.base, env))
        self.cd.storage.mkdir()
        self.candidate = {'sha': 'a' * 40, 'manifest': {'chaincode': 'b' * 64}}
        self.generation = 'c' * 32
        self.state = {'current': None, 'installation_generation': self.generation}
        self.receipt = {
            'protocol': 'agritrace-destructive-reinstall/1', 'generation': self.generation,
            'sha': self.candidate['sha'],
            'manifest_sha256': policy.sha256(json.dumps(self.candidate['manifest'], sort_keys=True, separators=(',', ':')).encode()),
            'removed_old_resources': True, 'backup': None, 'retained_previous_data': False,
        }
        self.save_receipt()

    def save_receipt(self):
        self.filename = self.cd.storage / 'reinstall-receipt.json'
        self.filename.write_text(json.dumps(self.receipt) + '\n')
        self.filename.chmod(0o600)
        self.cd.config['reinstall_ack'] = {
            k: self.receipt[k] for k in ['protocol', 'generation', 'sha', 'manifest_sha256']
        }
        self.cd.config['reinstall_ack']['receipt_sha256'] = policy.sha256(self.filename.read_bytes())

    def test_exact_private_receipt_accepts_only_its_fresh_generation(self):
        self.cd.admit_reinstallation(self.candidate, self.state)

    def test_changed_candidate_or_manifest_is_rejected(self):
        for candidate in [dict(self.candidate, sha='d' * 40), dict(self.candidate, manifest={'chaincode': 'd' * 64})]:
            with self.subTest(candidate=candidate), self.assertRaisesRegex(PolicyError, 'candidate and generation'):
                self.cd.admit_reinstallation(candidate, self.state)

    def test_missing_or_different_generation_is_rejected(self):
        for state in [{'current': None}, dict(self.state, installation_generation='d' * 32)]:
            with self.subTest(state=state), self.assertRaisesRegex(PolicyError, 'candidate and generation'):
                self.cd.admit_reinstallation(self.candidate, state)

    def test_edited_receipt_is_not_accepted(self):
        self.filename.write_text(json.dumps(dict(self.receipt, removed_old_resources=False)))
        with self.assertRaisesRegex(PolicyError, 'checksum differs'):
            self.cd.admit_reinstallation(self.candidate, self.state)

    def test_receipt_must_explicitly_record_completed_removal_and_no_recovery(self):
        original = copy.deepcopy(self.receipt)
        for field, value in [('removed_old_resources', False), ('backup', False), ('retained_previous_data', True)]:
            self.receipt = dict(original, **{field: value})
            self.save_receipt()
            with self.subTest(field=field), self.assertRaisesRegex(PolicyError, 'completed removal'):
                self.cd.admit_reinstallation(self.candidate, self.state)

    def test_missing_receipt_is_rejected(self):
        self.filename.unlink()
        with self.assertRaisesRegex(PolicyError, 'receipt is missing'):
            self.cd.admit_reinstallation(self.candidate, self.state)

    def test_readable_or_writable_group_permissions_are_rejected(self):
        for mode in [0o640, 0o620, 0o604]:
            self.filename.chmod(mode)
            with self.subTest(mode=mode), self.assertRaisesRegex(PolicyError, 'private to the controller owner'):
                self.cd.admit_reinstallation(self.candidate, self.state)

    def test_symlink_cannot_supply_the_removal_receipt(self):
        destination = self.base / 'elsewhere.json'
        self.filename.rename(destination)
        self.filename.symlink_to(destination)
        with self.assertRaisesRegex(PolicyError, 'receipt is missing'):
            self.cd.admit_reinstallation(self.candidate, self.state)


if __name__ == '__main__':
    unittest.main()
