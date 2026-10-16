import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TraceService } from './trace.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import { scopedTraceEventReadWhere } from '../supply-chains/business-read-scope.js';
import {
  fixtureRoute,
  useFixtureRoute,
} from '../../../test/support/ledger-route-fixture.js';

beforeEach(useFixtureRoute);

describe('TraceService transactional outbox', () => {
  it('projects only public-safe fields in lot history', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const access = { assertLotAccess: vi.fn().mockResolvedValue(undefined) };
    const service = new TraceService(
      { traceEvent: { findMany } } as unknown as PrismaService,
      access as unknown as OrganizationAccessService,
    );
    const actor = {
      sub: '11111111-1111-4111-8111-111111111111',
      organizationId: '22222222-2222-4222-8222-222222222222',
      role: 'FARM_STAFF',
    };

    const lotId = '33333333-3333-4333-8333-333333333333';
    await service.getLotHistory(lotId, actor);

    expect(access.assertLotAccess).toHaveBeenCalled();
    expect(findMany.mock.calls[0][0].where).toEqual({
      AND: [{ lotId }, scopedTraceEventReadWhere(actor)],
    });
    const selection = findMany.mock.calls[0][0].select;
    expect(selection).not.toHaveProperty('actorAuthProof');
    expect(selection).not.toHaveProperty('actorUserId');
    expect(selection).not.toHaveProperty('businessData');
    expect(selection.blockchainOutbox.select).not.toHaveProperty('lastError');
    expect(selection.blockchainProof.select).not.toHaveProperty('lastError');
  });

  it('creates the trace event and outbox row without creating a pending proof', async () => {
    const event = {
      id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      dataHash: 'a'.repeat(64),
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      $queryRaw: vi.fn().mockResolvedValue([]),
      traceEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(event),
      },
      blockchainOutbox: { create: vi.fn().mockResolvedValue({}) },
      blockchainProof: { create: vi.fn() },
      ledgerRouteDefinition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(fixtureRoute),
      },
      eventLedgerRoute: { create: vi.fn().mockResolvedValue({}) },
    };
    const service = new TraceService(
      {} as PrismaService,
      {} as OrganizationAccessService,
    );

    await service.createInTransaction(
      tx as unknown as Prisma.TransactionClient,
      {
        entityType: 'LOT',
        entityId: '631e9648-174d-48a0-9494-353bda8775da',
        lotId: '631e9648-174d-48a0-9494-353bda8775da',
        eventType: 'HARVEST_RECORDED',
        actor: { sub: null, organizationId: null, role: 'SYSTEM' },
        businessData: { quantity: '100' },
      },
    );

    expect(tx.blockchainOutbox.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventId: event.id,
        status: 'PENDING',
      }),
    });
    expect(tx.blockchainProof.create).not.toHaveBeenCalled();
    expect(tx.eventLedgerRoute.create).toHaveBeenCalledWith({
      data: { eventId: event.id, definitionDigest: fixtureRoute.digest },
    });
    expect(tx.eventLedgerRoute.create.mock.invocationCallOrder[0]).toBeLessThan(
      tx.blockchainOutbox.create.mock.invocationCallOrder[0],
    );
    expect(tx.traceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schemaVersion: '2.0.0',
        canonicalizationVersion: 'RFC8785',
      }),
    });
  });
});
