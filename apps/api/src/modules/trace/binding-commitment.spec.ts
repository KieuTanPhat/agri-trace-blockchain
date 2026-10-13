import { describe, expect, it } from 'vitest';
import {
  B_ENVELOPE_VERSION,
  bindingDigest,
  bindingEventCommitment,
  canonicalPositiveInt,
  privateBodyDigest,
  unsignedBindingBody,
  type BindingEventContext,
  type BindingLogicalTuple,
} from './binding-commitment.js';

// Design vectors (docs/plans/hybrid-b-binding-and-permission-2026-10-13.md).
const u = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding: BindingLogicalTuple = {
  network: 'isolated-hybrid-b',
  channelId: 'hybrid-b',
  chaincodeName: 'agritrace',
  contractName: 'AgriTraceContract',
  chainRef: u(3),
  envelopeVersion: B_ENVELOPE_VERSION,
  writerAuthority: 'technical-relayer:agritrace-b',
  writerMspId: 'AgriTraceMSP',
  writerRole: 'relayer',
  governanceDigest: '22'.repeat(32),
};
const privateEvent = {
  id: u(1),
  entityType: 'PRODUCTION_CYCLE',
  entityId: u(2),
  cycleId: u(2),
  lotId: null,
  eventType: 'PRODUCTION_CYCLE_CREATED',
  eventTime: new Date('2026-10-13T00:00:00.000Z'),
  previousEventHash: null,
  actorUserId: u(5),
  actorOrganizationId: u(6),
  actorRole: 'FARM_STAFF',
  authProofType: 'TOKEN_FINGERPRINT',
  actorAuthProof: 'ab'.repeat(32),
  businessData: { farmId: u(7), productId: u(8) },
  schemaVersion: '2.0.0',
  canonicalizationVersion: 'RFC8785',
};
const context = (overrides: Partial<BindingEventContext> = {}) => ({
  eventId: u(1),
  entityType: 'PRODUCTION_CYCLE',
  entityId: u(2),
  cycleId: u(2),
  lotId: null,
  eventType: 'PRODUCTION_CYCLE_CREATED',
  eventTime: new Date('2026-10-13T00:00:00.000Z'),
  previousEventHash: null,
  bindingDigest: bindingDigest(binding),
  chainRef: u(3),
  permissions: [{ permissionRef: u(4), epoch: '1', ordinal: '1' }],
  ...overrides,
});

describe('Release B commitment vectors', () => {
  it('matches the canonical binding vector', () => {
    expect(bindingDigest(binding)).toBe(
      'f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0',
    );
  });
  it('matches the private body V2 vector', () => {
    expect(privateBodyDigest(privateEvent)).toBe(
      '82ecc32d8bb61593552050a1a7225bf296e5a08b1a5b8188155ff5ec6d18c8e0',
    );
  });
  it('matches the commitment B vector and its two tamper vectors', () => {
    const body = privateBodyDigest(privateEvent);
    expect(bindingEventCommitment(context(), body)).toBe(
      '0418324c37f1d1d33116d61478920bc157b17e877d3aedf2fc166e7586df2c88',
    );
    expect(bindingEventCommitment(context({ chainRef: u(9) }), body)).toBe(
      'e733f023c83d5a5cdca7287c867fa0cbc75b75ae6eb34c7049e9c5f0cf3cce1a',
    );
    expect(
      bindingEventCommitment(
        context({
          permissions: [{ permissionRef: u(4), epoch: '2', ordinal: '1' }],
        }),
        body,
      ),
    ).toBe('a4254cc2a430ccba18ef2336a2f3ba4f1d5ce66f6378119ee5b30bd3096e7dcc');
  });
});

describe('Release B commitment validation', () => {
  const body = privateBodyDigest(privateEvent);
  it('sorts permissions and rejects duplicates, bad counts and non-canonical numbers', () => {
    const a = { permissionRef: u(20), epoch: '1', ordinal: '2' };
    const b = { permissionRef: u(10), epoch: '3', ordinal: '4' };
    expect(bindingEventCommitment(context({ permissions: [a, b] }), body)).toBe(
      bindingEventCommitment(context({ permissions: [b, a] }), body),
    );
    expect(() =>
      bindingEventCommitment(context({ permissions: [a, a] }), body),
    ).toThrow('Duplicate');
    expect(() =>
      bindingEventCommitment(context({ permissions: [] }), body),
    ).toThrow('1-16');
    expect(() =>
      bindingEventCommitment(
        context({
          permissions: Array.from({ length: 17 }, (_, i) => ({
            permissionRef: u(100 + i),
            epoch: '1',
            ordinal: '1',
          })),
        }),
        body,
      ),
    ).toThrow('1-16');
    for (const bad of [
      '0',
      '01',
      '-1',
      '1.0',
      '1e3',
      ' 1',
      '9223372036854775808',
    ])
      expect(() => canonicalPositiveInt(bad)).toThrow();
    expect(canonicalPositiveInt('9223372036854775807')).toBe(
      '9223372036854775807',
    );
  });
  it('binds every public field so a swapped sidecar changes the hash', () => {
    const base = bindingEventCommitment(context(), body);
    for (const changed of [
      context({ eventId: u(11) }),
      context({ entityId: u(12) }),
      context({ eventType: 'PRODUCTION_CYCLE_PLANTED' }),
      context({ eventTime: new Date('2026-10-13T00:00:00.001Z') }),
      context({ previousEventHash: 'c'.repeat(64) }),
      context({ bindingDigest: 'd'.repeat(64) }),
    ])
      expect(bindingEventCommitment(changed, body)).not.toBe(base);
    expect(bindingEventCommitment(context(), 'e'.repeat(64))).not.toBe(base);
  });
  it('keeps every nullable field present as JSON null', () => {
    const unsigned = unsignedBindingBody(context(), body);
    expect(unsigned.lotId).toBeNull();
    expect(unsigned.previousEventHash).toBeNull();
    expect(Object.keys(unsigned)).toContain('lotId');
  });
  it('excludes host/credential details from the binding digest', () => {
    expect(() =>
      bindingDigest({ ...binding, envelopeVersion: '3.0.0' }),
    ).toThrow();
    expect(() => bindingDigest({ ...binding, writerRole: 'admin' })).toThrow();
    expect(() =>
      bindingDigest({ ...binding, chainRef: 'not-a-uuid' }),
    ).toThrow();
  });
});
