import { ForbiddenException } from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { OrganizationAccessService } from '../src/modules/auth/organization-access.service.js';
import { TraceService } from '../src/modules/trace/trace.service.js';

describe('TraceService organization access', () => {
  const lotId = 'a6d7dacc-da9a-45b9-b144-5563ae822715';
  const eventId = 'b9038f8a-5a42-49fc-aa62-93225c5b7994';
  const farmOrgId = '5f664af2-3522-4f18-bebb-38aa135bbcad';
  const otherOrgId = '758238df-002a-4a5f-9523-a04949bf01bb';

  const farmActor = {
    sub: '34695828-dd6f-4463-8607-a9758a2967d6',
    organizationId: farmOrgId,
    role: 'FARM_STAFF',
  };

  const otherActor = {
    ...farmActor,
    organizationId: otherOrgId,
  };

  const prisma = {
    lot: { findUnique: vi.fn() },
    productionCycle: { findUnique: vi.fn() },
    traceEvent: { findMany: vi.fn() },
    blockchainProof: { findUnique: vi.fn() },
  };

  const access = new OrganizationAccessService(
    prisma as unknown as PrismaService,
  );

  const service = new TraceService(
    prisma as unknown as PrismaService,
    access,
  );

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('allows the farm organization to view its lot history', async () => {
    prisma.lot.findUnique.mockResolvedValue({
      id: lotId,
      farmOrgId,
      shipment: null,
    });
    prisma.traceEvent.findMany.mockResolvedValue([{ id: eventId }]);

    await expect(
      service.getLotHistory(lotId, farmActor),
    ).resolves.toEqual([{ id: eventId }]);

    expect(prisma.traceEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { lotId } }),
    );
  });

  it('does not return lot history to another organization', async () => {
    prisma.lot.findUnique.mockResolvedValue({
      id: lotId,
      farmOrgId,
      shipment: null,
    });

    await expect(
      service.getLotHistory(lotId, otherActor),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.traceEvent.findMany).not.toHaveBeenCalled();
  });

  it('does not return proof for another organization’s lot', async () => {
    prisma.blockchainProof.findUnique.mockResolvedValue({
      eventId,
      traceEvent: { lotId, cycleId: null },
    });
    prisma.lot.findUnique.mockResolvedValue({
      id: lotId,
      farmOrgId,
      shipment: null,
    });

    await expect(
      service.getProof(eventId, otherActor),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});