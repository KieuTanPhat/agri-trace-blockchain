import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { OrganizationAccessService } from './organization-access.service.js';

type Actor = AuthenticatedRequest['user'];

function actor(
  role = 'FARM_STAFF',
  organizationId: string | null = 'farm-org-id',
): Actor {
  return {
    sub: '11111111-1111-1111-1111-111111111111',
    sid: '22222222-2222-4222-8222-222222222222',
    email: 'user@example.local',
    role,
    organizationId,
    accountStatus: 'ACTIVE',
  };
}

describe('OrganizationAccessService', () => {
  const prisma = {
    farm: {
      findUnique: vi.fn(),
    },
    productionCycle: {
      findUnique: vi.fn(),
      findFirst: vi.fn().mockResolvedValue({ id: 'cycle-id' }),
    },
    lot: {
      findFirst: vi.fn(),
    },
    shipment: {
      findFirst: vi.fn(),
    },
  };

  const service = new OrganizationAccessService(
    prisma as unknown as PrismaService,
  );

  it('allows SYSTEM_ADMIN to access every farm', async () => {
    prisma.farm.findUnique.mockResolvedValue({
      id: 'farm-id',
      organizationId: 'farm-org-id',
    });

    await expect(
      service.assertFarmAccess(actor('SYSTEM_ADMIN', null), 'farm-id'),
    ).resolves.toEqual({
      id: 'farm-id',
      organizationId: 'farm-org-id',
    });
  });

  it('allows a user from the farm owner organization', async () => {
    prisma.farm.findUnique.mockResolvedValue({
      id: 'farm-id',
      organizationId: 'farm-org-id',
    });

    await expect(
      service.assertFarmAccess(actor('FARM_STAFF', 'farm-org-id'), 'farm-id'),
    ).resolves.toBeDefined();
  });

  it('rejects a user from another organization', async () => {
    prisma.farm.findUnique.mockResolvedValue({
      id: 'farm-id',
      organizationId: 'farm-org-id',
    });

    await expect(
      service.assertFarmAccess(
        actor('FARM_STAFF', 'another-organization-id'),
        'farm-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects when the farm does not exist', async () => {
    prisma.farm.findUnique.mockResolvedValue(null);

    await expect(
      service.assertFarmAccess(actor(), 'missing-farm-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns a shipment only through the scoped chain read filter', async () => {
    prisma.shipment.findFirst.mockResolvedValue({ id: 'shipment-id' });

    await expect(
      service.assertShipmentAccess(
        actor('RETAILER', 'retailer-org-id'),
        'shipment-id',
      ),
    ).resolves.toEqual({ id: 'shipment-id' });
    const where = prisma.shipment.findFirst.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ id: 'shipment-id' });
    expect(JSON.stringify(where.AND[1])).toContain('stageAssignments');
  });

  it('hides out-of-scope and missing shipments behind the same 404', async () => {
    prisma.shipment.findFirst.mockResolvedValue(null);

    await expect(
      service.assertShipmentAccess(
        actor('FARM_STAFF', 'unrelated-org-id'),
        'shipment-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never grants platform admins raw business reads', async () => {
    prisma.lot.findFirst.mockResolvedValue(null);
    await expect(
      service.assertLotAccess(actor('SYSTEM_ADMIN', null), 'lot-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.lot.findFirst.mock.calls[0][0].where.AND[1]).toEqual({
      id: '00000000-0000-0000-0000-000000000000',
    });
  });
});
