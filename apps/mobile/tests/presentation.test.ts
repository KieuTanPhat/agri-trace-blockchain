import test from 'node:test';
import assert from 'node:assert/strict';
import { traceWarningItems } from '../src/trace/presentation';
import { publicLot } from './fixtures';

test('does not duplicate expiry and no-data warnings', () => {
  const warnings = traceWarningItems(
    publicLot({
      isExpired: true,
      warnings: ['EXPIRED', 'NO_DATA', 'EXPIRED'],
    }),
  );

  assert.deepEqual(
    warnings.map((warning) => warning.key),
    ['EXPIRED', 'NO_DATA'],
  );

  assert.equal(warnings[0].danger, true);
  assert.equal(warnings[1].danger, false);

  assert.equal(
    warnings.some((warning) =>
      ['EXPIRED', 'NO_DATA'].includes(warning.message),
    ),
    false,
  );
});

test('VERIFIED proof does not hide recall or expiry', () => {
  const warnings = traceWarningItems(
    publicLot({
      currentState: 'RECALLED',
      isExpired: true,
      proofStatus: 'VERIFIED',
      warnings: ['RECALLED', 'EXPIRED'],
    }),
  );

  assert.equal(warnings[0].key, 'RECALLED');
  assert.equal(warnings[1].key, 'EXPIRED');
});

test('merges quantity and state integrity warnings', () => {
  const warnings = traceWarningItems(
    publicLot({
      quantityReconciled: false,
      stateReconciled: false,
      warnings: ['QUANTITY_MISMATCH', 'STATE_MISMATCH'],
    }),
  );

  assert.equal(
    warnings.filter((warning) => warning.key === 'INTEGRITY_WARNING')
      .length,
    1,
  );
});

test('does not silently discard an unknown API warning', () => {
  const warnings = traceWarningItems(
    publicLot({
      warnings: ['NEW_SERVER_WARNING'],
    }),
  );

  assert.ok(
    warnings.some((warning) => warning.key === 'ADDITIONAL_WARNING'),
  );
});