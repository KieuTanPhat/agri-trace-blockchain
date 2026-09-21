import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { TraceService } from './trace.service.js';

describe('TraceService transactional outbox', () => {
  it('creates the trace event and outbox row without creating a pending proof', async () => {
    const event = {
      id: 'd6212d56-a3b2-4d54-9779-cc8507a6bd53',
      dataHash: 'a'.repeat(64),
    };
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      traceEvent: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(event),
      },
      blockchainOutbox: { create: vi.fn().mockResolvedValue({}) },
      blockchainProof: { create: vi.fn() },
    };
    const service = new TraceService({} as PrismaService);

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
  });
});
