import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { BlockchainProofQueryService } from '../blockchain-adapter/blockchain-proof-query.service.js';
import { scopedTraceEventReadWhere } from '../supply-chains/business-read-scope.js';
import { fixtureRoute } from '../../../test/support/ledger-route-fixture.js';
import { calculateTraceEventHash } from './trace-hash.js';
import { TraceService } from './trace.service.js';

const actor = {
  sub: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
  role: 'FARM_STAFF',
};

function fixture(endpoint: 'proof' | 'verify', diagnostic: string | null) {
  const body = {
    id: '33333333-3333-4333-8333-333333333333',
    entityType: 'CARE',
    entityId: '44444444-4444-4444-8444-444444444444',
    cycleId: '55555555-5555-4555-8555-555555555555',
    lotId: null,
    eventType: 'CARE_RECORDED',
    eventTime: new Date('2026-10-01T00:00:00.000Z'),
    actorUserId: actor.sub,
    actorOrganizationId: actor.organizationId,
    actorRole: actor.role,
    authProofType: 'TOKEN_FINGERPRINT',
    actorAuthProof: 'a'.repeat(64),
    businessData: { note: 'private-business-sentinel' },
    previousEventHash: null,
    schemaVersion: '2.0.0',
    canonicalizationVersion: 'RFC8785',
  };
  const event = {
    ...body,
    dataHash: calculateTraceEventHash(body),
    blockchainProof: null,
    blockchainOutbox: {
      status: 'DEAD_LETTER',
      attemptCount: 2,
      nextAttemptAt: null,
      lastError: diagnostic,
      leaseToken: 'private-lease-sentinel',
    },
    ledgerRoute: {
      definitionDigest: fixtureRoute.digest,
      definition: fixtureRoute,
    },
  };
  const findFirst = vi.fn().mockResolvedValue(event);
  const assertTraceEventAccess = vi.fn().mockResolvedValue(undefined);
  const db = { traceEvent: { findFirst } } as unknown as PrismaService;
  const access = {
    assertTraceEventAccess,
  } as unknown as OrganizationAccessService;
  const read = () =>
    endpoint === 'proof'
      ? new TraceService(db, access).getProof(event.id, actor)
      : new BlockchainProofQueryService(db, access).verify(event.id, actor);
  return { event, findFirst, assertTraceEventAccess, read };
}

describe.each(['proof', 'verify'] as const)('%s privacy boundary', (endpoint) => {
  it('hides worker diagnostics and private evidence while retaining proof state', async () => {
    const { event, findFirst, read } = fixture(
      endpoint,
      'gateway failed: token=private-diagnostic-sentinel',
    );
    const response = await read();
    expect(response).toMatchObject({
      eventId: event.id,
      lastError: 'Blockchain delivery failed; contact support with eventId',
      localHashMatches: true,
      proofStatus: 'BLOCKCHAIN_UNAVAILABLE',
      attemptCount: 2,
    });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain('private-');
    for (const field of ['actorAuthProof', 'actorUserId', 'businessData', 'leaseToken'])
      expect(response).not.toHaveProperty(field);
    expect(event.blockchainOutbox.lastError).toContain('private-diagnostic-sentinel');
    expect(findFirst.mock.calls[0][0].where).toEqual({
      AND: [{ id: event.id }, scopedTraceEventReadWhere(actor)],
    });
  });

  it('returns no diagnostic when none is recorded', async () => {
    const { read } = fixture(endpoint, null);
    expect((await read()).lastError).toBeNull();
  });

  it('does not query evidence after access is denied', async () => {
    const { assertTraceEventAccess, findFirst, read } = fixture(endpoint, null);
    assertTraceEventAccess.mockRejectedValue(new ForbiddenException());
    await expect(read()).rejects.toBeInstanceOf(ForbiddenException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('fails closed if the final scoped read cannot find the event', async () => {
    const { findFirst, read } = fixture(endpoint, null);
    findFirst.mockResolvedValue(null);
    await expect(read()).rejects.toBeInstanceOf(NotFoundException);
  });
});
