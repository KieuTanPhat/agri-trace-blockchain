import { describe, expect, it } from 'vitest';
import {
  GENESIS_HASH,
  platformAuditEntryHash,
  redactDetails,
  type HashableAuditRow,
} from './platform-audit.js';
import { csvCell } from './platform-audit.service.js';

const row: HashableAuditRow = {
  sequence: 7n,
  occurredAt: new Date('2026-10-18T01:02:03.456Z'),
  actorUserId: '8fb589c9-e423-4b3e-a492-a521b9094166',
  actorRole: 'SYSTEM_ADMIN',
  action: 'USER_STATUS_CHANGED',
  subjectType: 'USER',
  subjectId: 'abc',
  organizationId: null,
  reason: 'Lý do kiểm tra',
  requestId: 'req-1',
  idempotencyKey: 'key-1',
  outcome: 'SUCCESS',
  details: { from: 'ACTIVE', to: 'LOCKED' },
  prevHash: GENESIS_HASH,
};

describe('platform audit hashing', () => {
  it('is deterministic and independent of detail key order', () => {
    const a = platformAuditEntryHash(row);
    expect(a).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      platformAuditEntryHash({
        ...row,
        details: { to: 'LOCKED', from: 'ACTIVE' },
      }),
    ).toBe(a);
  });

  it.each([
    ['sequence', { sequence: 8n }],
    ['time', { occurredAt: new Date('2026-10-18T01:02:03.457Z') }],
    ['actor', { actorUserId: null }],
    ['action', { action: 'USER_UNLOCKED' }],
    ['reason', { reason: 'Lý do khác' }],
    ['details', { details: { from: 'ACTIVE', to: 'INACTIVE' } }],
    ['previous hash', { prevHash: 'a'.repeat(64) }],
  ])('changes when the %s changes', (_label, change) => {
    expect(platformAuditEntryHash({ ...row, ...change })).not.toBe(
      platformAuditEntryHash(row),
    );
  });
});

describe('audit detail redaction', () => {
  it('masks credential-like keys at any depth and keeps ordinary data', () => {
    expect(
      redactDetails({
        password: 'x',
        passwordHash: 'y',
        temporaryPassword: 'z',
        mfaSecret: 's',
        otpCode: '123456',
        recoveryCodes: ['a'],
        refreshToken: 't',
        nested: { Authorization: 'Bearer abc', role: 'SYSTEM_ADMIN' },
        list: [{ privateKey: 'k', name: 'ok' }],
        code: 'TRANSPORTER',
        payloadHash: 'abc',
      }),
    ).toEqual({
      password: '[REDACTED]',
      passwordHash: '[REDACTED]',
      temporaryPassword: '[REDACTED]',
      mfaSecret: '[REDACTED]',
      otpCode: '[REDACTED]',
      recoveryCodes: '[REDACTED]',
      refreshToken: '[REDACTED]',
      nested: { Authorization: '[REDACTED]', role: 'SYSTEM_ADMIN' },
      list: [{ privateKey: '[REDACTED]', name: 'ok' }],
      code: 'TRANSPORTER',
      payloadHash: 'abc',
    });
  });
});

describe('CSV export cells', () => {
  it('quotes separators and neutralizes formula prefixes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(null)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});
