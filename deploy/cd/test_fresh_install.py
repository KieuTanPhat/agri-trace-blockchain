"""Failure boundaries for the new empty-target delivery protocol."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock
from controller import Controller, atomic_json, PolicyError


class FirstInstallation(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        env = base / '.env'
        env.write_text('POSTGRES_USER=test\nPOSTGRES_DB=agri_trace_prod\n')
        self.cd = Controller({'base': str(base), 'env': str(env), 'accounts': str(base / 'accounts.json')})
        self.cd.fresh = True
        self.cd.config.update(open_after_smoke=True)
        self.cd.storage.mkdir()
        self.candidate = {'id': 'prod-' + 'a' * 40, 'sha': 'a' * 40, 'verified': False, 'manifest': {'chaincode': 'b' * 64}}
        self.state = {'current': None, 'previous': None, 'chaincode': {'sequence': 0}}
        for method in ['preflight', 'admit_fresh_release', 'register_fresh_backup', 'migration_policy', 'protect_hybrid_schema', 'migrate',
                       'bootstrap_hosted', 'start', 'stop', 'save_record', 'switch']:
            setattr(self.cd, method, MagicMock())
        self.cd.dc = MagicMock(return_value=['docker', 'compose'])
        self.cd.run = MagicMock(side_effect=lambda label, *args, **kwargs: b'0\n' if label == 'fresh-empty-database' else b'')
        self.cd.verify = MagicMock(return_value={'result': 'passed', 'counts': {'trace_event': 12}})
        self.cd.definition = MagicMock(return_value={'sequence': 1})

    def test_empty_target_becomes_verified_only_after_real_smoke_boundary(self):
        modes = []
        self.cd.start.side_effect = lambda record: modes.append(self.cd.fresh_write_mode(record))
        result = self.cd.first_install(self.candidate, self.state)
        self.assertEqual(result['result'], 'fresh-installed')
        self.assertEqual(modes, ['CLOSED', 'OPEN', 'OPEN'])
        self.cd.bootstrap_hosted.assert_called_once_with(self.candidate)
        self.cd.verify.assert_called_once_with(self.candidate, self.candidate['sha'])
        self.assertTrue(self.candidate['verified'])
        self.assertFalse((self.cd.storage / 'journal.json').exists())
        self.assertEqual(self.cd.switch.call_args.args[1]['previous'], None)

    def test_nonempty_database_is_never_reset_or_migrated(self):
        self.cd.run.side_effect = lambda label, *args, **kwargs: b'4\n' if label == 'fresh-empty-database' else b''
        with self.assertRaisesRegex(PolicyError, 'existing schema'):
            self.cd.first_install(self.candidate, self.state)
        self.cd.migrate.assert_not_called()
        self.cd.bootstrap_hosted.assert_not_called()
        self.cd.stop.assert_called_once()
        self.assertFalse(json.loads((self.cd.storage / 'journal.json').read_text())['emptyDatabaseVerified'])

    def test_unknown_smoke_holds_writers_and_journal_for_same_candidate(self):
        self.cd.verify.side_effect = PolicyError('unknown command outcome')
        with self.assertRaisesRegex(PolicyError, 'unknown command'):
            self.cd.first_install(self.candidate, self.state)
        journal = json.loads((self.cd.storage / 'journal.json').read_text())
        self.assertEqual(journal['stage'], 'fresh-smoke')
        self.assertEqual(journal['candidate'], self.candidate['id'])
        self.assertFalse(self.candidate['verified'])
        self.cd.switch.assert_not_called()
        self.assertEqual(self.cd.fresh_write_mode(self.candidate), 'CLOSED')
        self.cd.stop.assert_called_once()

    def test_recovery_validates_applied_checksums_before_migration(self):
        atomic_json(self.cd.storage / 'journal.json', {'previous': None, 'candidate': self.candidate['id'], 'stage': 'fresh-migration', 'emptyDatabaseVerified': True})
        self.cd.run.side_effect = lambda label, *args, **kwargs: b't\n' if label == 'fresh-migration-table' else b''
        self.cd.applied = MagicMock(return_value={'historical': 'c' * 64})
        self.cd.migration_policy.side_effect = PolicyError('checksum differs')
        with self.assertRaisesRegex(PolicyError, 'checksum differs'):
            self.cd.first_install(self.candidate, self.state, resume=True)
        self.cd.applied.assert_called_once_with(self.candidate)
        self.cd.migrate.assert_not_called()
        self.cd.bootstrap_hosted.assert_not_called()

    def test_unfinished_migration_cannot_be_implicitly_resolved(self):
        atomic_json(self.cd.storage / 'journal.json', {'previous': None, 'candidate': self.candidate['id'], 'stage': 'fresh-migration', 'emptyDatabaseVerified': True})
        self.cd.run.side_effect = lambda label, *args, **kwargs: b't\n' if label == 'fresh-migration-table' else b''
        self.cd.applied = MagicMock(side_effect=PolicyError('unfinished migration'))
        with self.assertRaisesRegex(PolicyError, 'unfinished migration'):
            self.cd.first_install(self.candidate, self.state, resume=True)
        self.cd.migrate.assert_not_called()

    def test_crash_after_state_promotion_can_finish_same_installation(self):
        candidate = dict(self.candidate, verified=True)
        atomic_json(self.cd.storage / 'journal.json', {'previous': None, 'candidate': candidate['id'], 'stage': 'verified', 'emptyDatabaseVerified': True})
        self.cd.applied = MagicMock(return_value={})
        self.assertEqual(self.cd.first_install(candidate, dict(self.state, current=candidate['id']), resume=True)['result'], 'fresh-installed')
        self.assertFalse((self.cd.storage / 'journal.json').exists())

    def test_interrupted_delivery_cannot_open_even_a_verified_image(self):
        candidate = dict(self.candidate, verified=True)
        self.cd.config['writes_mode'] = 'OPEN'
        atomic_json(self.cd.storage / 'journal.json', {})
        self.assertEqual(self.cd.fresh_write_mode(candidate), 'CLOSED')
        (self.cd.storage / 'journal.json').unlink()
        self.assertEqual(self.cd.fresh_write_mode(candidate), 'OPEN')
        self.assertEqual(self.cd.fresh_write_mode(self.candidate), 'CLOSED')

    def test_recovery_refuses_a_different_candidate_and_keeps_the_journal(self):
        atomic_json(self.cd.storage / 'journal.json', {'previous': None, 'candidate': 'different'})
        with self.assertRaisesRegex(PolicyError, 'candidate differs'):
            self.cd.first_install(self.candidate, self.state, resume=True)
        self.cd.preflight.assert_not_called()
        self.assertTrue((self.cd.storage / 'journal.json').exists())


if __name__ == '__main__':
    unittest.main()
