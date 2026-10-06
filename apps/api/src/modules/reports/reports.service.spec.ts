import {
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Actor } from '../trace/trace.service.js';
import { ReportGroupBy } from './dto.js';
import {
  ReportAccessService,
  type ReportAccessScope,
} from './report-access.service.js';
import { ReportsService } from './reports.service.js';

describe('ReportsService', () => {
  const farmOrganizationId =
    '11111111-1111-1111-1111-111111111111';

  const transporterOrganizationId =
    '22222222-2222-2222-2222-222222222222';

  const retailerOrganizationId =
    '33333333-3333-3333-3333-333333333333';

  const productId =
    '44444444-4444-4444-4444-444444444444';

  const actor: Actor = {
    sub: '55555555-5555-5555-5555-555555555555',
    organizationId: farmOrganizationId,
    role: 'FARM_STAFF',
  };

  const prisma = {
    harvestEvent: {
      findMany: vi.fn(),
    },
    shipment: {
      findMany: vi.fn(),
    },
    quantityMovement: {
      findMany: vi.fn(),
    },
  };

  const access = {
    resolveScope: vi.fn(),
  };

  const service = new ReportsService(
    prisma as unknown as PrismaService,
    access as unknown as ReportAccessService,
  );

  const farmScope: ReportAccessScope = {
    unrestricted: false,
    organizationId: farmOrganizationId,
    role: 'FARM_STAFF',
  };

  beforeEach(() => {
    vi.resetAllMocks();

    access.resolveScope.mockResolvedValue(farmScope);

    prisma.harvestEvent.findMany.mockResolvedValue([]);
    prisma.shipment.findMany.mockResolvedValue([]);
    prisma.quantityMovement.findMany.mockResolvedValue([]);
  });

  it('rejects when from is after to', async () => {
    await expect(
      service.getActivityReport(
        {
          from: '2026-10-10T00:00:00.000Z',
          to: '2026-10-01T00:00:00.000Z',
          groupBy: ReportGroupBy.DAY,
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(access.resolveScope).not.toHaveBeenCalled();
    expect(prisma.harvestEvent.findMany).not.toHaveBeenCalled();
  });

  it('passes requested organization to access service', async () => {
    await service.getActivityReport(
      {
        organizationId: farmOrganizationId,
        groupBy: ReportGroupBy.DAY,
      },
      actor,
    );

    expect(access.resolveScope).toHaveBeenCalledWith(
      actor,
      farmOrganizationId,
    );
  });

  it('applies farm organization scope to database queries', async () => {
    await service.getActivityReport(
      {
        productId,
        groupBy: ReportGroupBy.DAY,
      },
      actor,
    );

    expect(prisma.harvestEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
            where: expect.objectContaining({
            AND: expect.arrayContaining([
                {
                cycle: {
                    productId,
                },
                },
                {
                cycle: {
                    farmOrgId: farmOrganizationId,
                },
                },
            ]),
            }),
        }),
    );

    expect(prisma.shipment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
            where: expect.objectContaining({
            AND: expect.arrayContaining([
                {
                lot: {
                    productId,
                },
                },
                {
                lot: {
                    farmOrgId: farmOrganizationId,
                },
                },
            ]),
            }),
        }),
    );

    expect(
      prisma.quantityMovement.findMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'DAMAGE_OUT',
          lot: expect.objectContaining({
            productId,
            farmOrgId: farmOrganizationId,
          }),
        }),
      }),
    );
  });

  it('calculates all report quantities from recorded transactions', async () => {
    const eventDate = new Date(
      '2026-10-01T08:00:00.000Z',
    );

    prisma.harvestEvent.findMany.mockResolvedValue([
      {
        id: '66666666-6666-6666-6666-666666666666',
        harvestTime: eventDate,
        quantity: 100,
        unit: 'kg',
        cycle: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
        },
      },
    ]);

    prisma.shipment.findMany.mockResolvedValue([
      {
        id: '77777777-7777-7777-7777-777777777777',
        createdAt: eventDate,
        receivedTime: eventDate,
        shippedQuantity: 90,
        receivedQuantity: 70,
        rejectedQuantity: 10,
        lot: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
        },
        transporter: {
          id: transporterOrganizationId,
          name: 'Vận tải Minh Phát',
        },
        retailer: {
          id: retailerOrganizationId,
          name: 'Cửa hàng An Tâm',
        },
      },
    ]);

    prisma.quantityMovement.findMany.mockResolvedValue([
      {
        id: '88888888-8888-8888-8888-888888888888',
        quantity: 10,
        unit: 'kg',
        createdAt: eventDate,
        traceEvent: {
          businessData: {
            stage: 'FARM_BEFORE_HANDOVER',
          },
        },
        lot: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
          shipment: {
            transporter: {
              id: transporterOrganizationId,
              name: 'Vận tải Minh Phát',
            },
          },
        },
      },
      {
        id: '99999999-9999-9999-9999-999999999999',
        quantity: 10,
        unit: 'kg',
        createdAt: eventDate,
        traceEvent: {
          businessData: {
            stage: 'IN_TRANSIT',
          },
        },
        lot: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
          shipment: {
            transporter: {
              id: transporterOrganizationId,
              name: 'Vận tải Minh Phát',
            },
          },
        },
      },
    ]);

    const result = await service.getActivityReport(
      {
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-01T23:59:59.999Z',
        groupBy: ReportGroupBy.DAY,
      },
      actor,
    );

    expect(result.totals).toEqual({
      harvestedQuantity: 100,
      shippedQuantity: 90,
      receivedQuantity: 70,
      farmDamagedQuantity: 10,
      transportDamagedQuantity: 10,
      rejectedQuantity: 10,
    });

    expect(result.groups).toHaveLength(1);

    expect(result.groups[0]).toEqual({
      key: '2026-10-01',
      label: '2026-10-01',
      harvestedQuantity: 100,
      shippedQuantity: 90,
      receivedQuantity: 70,
      farmDamagedQuantity: 10,
      transportDamagedQuantity: 10,
      rejectedQuantity: 10,
    });
  });

  it('groups report by product', async () => {
    prisma.harvestEvent.findMany.mockResolvedValue([
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        harvestTime: new Date(
          '2026-10-01T08:00:00.000Z',
        ),
        quantity: 60,
        unit: 'kg',
        cycle: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
        },
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        harvestTime: new Date(
          '2026-10-02T08:00:00.000Z',
        ),
        quantity: 40,
        unit: 'kg',
        cycle: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
        },
      },
    ]);

    const result = await service.getActivityReport(
      {
        groupBy: ReportGroupBy.PRODUCT,
      },
      actor,
    );

    expect(result.groups).toHaveLength(1);

    expect(result.groups[0]).toEqual(
      expect.objectContaining({
        key: productId,
        label: 'Rau cải xanh',
        harvestedQuantity: 100,
      }),
    );
  });

  it('groups report by organization', async () => {
    prisma.harvestEvent.findMany.mockResolvedValue([
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        harvestTime: new Date(
          '2026-10-01T08:00:00.000Z',
        ),
        quantity: 100,
        unit: 'kg',
        cycle: {
          product: {
            id: productId,
            productName: 'Rau cải xanh',
          },
          organization: {
            id: farmOrganizationId,
            name: 'Nông trại Tân Phú',
          },
        },
      },
    ]);

    const result = await service.getActivityReport(
      {
        groupBy: ReportGroupBy.ORGANIZATION,
      },
      actor,
    );

    expect(result.groups).toEqual([
      expect.objectContaining({
        key: farmOrganizationId,
        label: 'Nông trại Tân Phú',
        harvestedQuantity: 100,
      }),
    ]);
  });
});

describe('ReportAccessService', () => {
  const farmOrganizationId =
    '11111111-1111-1111-1111-111111111111';

  const anotherOrganizationId =
    '22222222-2222-2222-2222-222222222222';

  const prisma = {
    organization: {
      findUnique: vi.fn(),
    },
  };

  const service = new ReportAccessService(
    prisma as unknown as PrismaService,
  );

  beforeEach(() => {
    vi.resetAllMocks();

    prisma.organization.findUnique.mockResolvedValue({
      id: farmOrganizationId,
    });
  });

  it('prevents a user from requesting another organization report', async () => {
    const actor: Actor = {
      sub: '33333333-3333-3333-3333-333333333333',
      organizationId: farmOrganizationId,
      role: 'FARM_STAFF',
    };

    await expect(
      service.resolveScope(
        actor,
        anotherOrganizationId,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(
      prisma.organization.findUnique,
    ).not.toHaveBeenCalled();
  });

  it('uses the user organization when no organization is requested', async () => {
    const actor: Actor = {
      sub: '33333333-3333-3333-3333-333333333333',
      organizationId: farmOrganizationId,
      role: 'FARM_STAFF',
    };

    await expect(
      service.resolveScope(actor),
    ).resolves.toEqual({
      unrestricted: false,
      organizationId: farmOrganizationId,
      role: 'FARM_STAFF',
    });
  });

  it('allows system admin to request unrestricted report', async () => {
    const actor: Actor = {
      sub: '44444444-4444-4444-4444-444444444444',
      organizationId: null,
      role: 'SYSTEM_ADMIN',
    };

    await expect(
      service.resolveScope(actor),
    ).resolves.toEqual({
      unrestricted: true,
      organizationId: undefined,
      role: 'SYSTEM_ADMIN',
    });
  });
});