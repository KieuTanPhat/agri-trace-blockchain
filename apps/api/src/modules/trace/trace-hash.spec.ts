import { calculateTraceEventHash } from './trace-hash.js';

const event = {
  id: '11111111-1111-1111-1111-111111111111',
  entityType: 'LOT',
  entityId: '22222222-2222-2222-2222-222222222222',
  cycleId: null,
  lotId: '22222222-2222-2222-2222-222222222222',
  eventType: 'LOT_CREATED',
  eventTime: new Date('2026-09-21T00:00:00.000Z'),
  actorUserId: '33333333-3333-3333-3333-333333333333',
  actorOrganizationId: '44444444-4444-4444-4444-444444444444',
  actorRole: 'FARM_STAFF',
  authProofType: 'TOKEN_FINGERPRINT',
  actorAuthProof: 'proof',
  businessData: { quantity: '10.000', unit: 'kg' },
  previousEventHash: null,
  schemaVersion: '2.0.0',
  canonicalizationVersion: 'RFC8785',
};

describe('trace event hash', () => {
  it('is stable for the same persisted event', () => {
    expect(calculateTraceEventHash(event)).toBe(
      calculateTraceEventHash({ ...event }),
    );
  });

  it('detects a business payload mutation', () => {
    expect(calculateTraceEventHash(event)).not.toBe(
      calculateTraceEventHash({
        ...event,
        businessData: { quantity: '9.000', unit: 'kg' },
      }),
    );
  });

  it.each([
    { actorUserId: '55555555-5555-5555-5555-555555555555' },
    { actorOrganizationId: '66666666-6666-6666-6666-666666666666' },
    { actorRole: 'RETAILER' },
    { authProofType: 'SYSTEM_ASSERTION' },
    { actorAuthProof: 'different-proof' },
    { schemaVersion: '3.0.0' },
    { canonicalizationVersion: 'different-canonicalization' },
  ])('detects actor or version mutation %j', (change) => {
    expect(calculateTraceEventHash(event)).not.toBe(
      calculateTraceEventHash({ ...event, ...change }),
    );
  });
});
