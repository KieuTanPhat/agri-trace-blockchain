import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
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
    },
    lot: {
      findUnique: vi.fn(),
    },
    shipment: {
      findUnique: vi.fn(),
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

  it('allows a retailer participating in a shipment', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'shipment-id',
      transporterOrgId: 'transporter-org-id',
      retailerOrgId: 'retailer-org-id',
      lot: {
        farmOrgId: 'farm-org-id',
      },
    });

    await expect(
      service.assertShipmentAccess(
        actor('RETAILER', 'retailer-org-id'),
        'shipment-id',
      ),
    ).resolves.toBeDefined();
  });

  it('rejects an organization outside the shipment participants', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      id: 'shipment-id',
      transporterOrgId: 'transporter-org-id',
      retailerOrgId: 'retailer-org-id',
      lot: {
        farmOrgId: 'farm-org-id',
      },
    });

    await expect(
      service.assertShipmentAccess(
        actor('FARM_STAFF', 'unrelated-org-id'),
        'shipment-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});