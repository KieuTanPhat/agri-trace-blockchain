import { vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { CatalogService } from './catalog.service.js';
import {
  FARM_SELECT,
  PLOT_SELECT,
  PRODUCT_SELECT,
} from './catalog-response.js';

function fixture() {
  const db = {
    product: {
      create: vi.fn().mockResolvedValue({ id: 'product' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    farm: {
      create: vi.fn().mockResolvedValue({ id: 'farm' }),
      findUnique: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    plot: {
      create: vi.fn().mockResolvedValue({ id: 'plot' }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    organization: { findUnique: vi.fn() },
  };
  return { db, service: new CatalogService(db as unknown as PrismaService) };
}

describe('Catalog service extraction', () => {
  it('preserves sorting, explicit response fields and organization scoping', async () => {
    const { service, db } = fixture();
    expect(
      await service.list({
        sub: 'user',
        role: 'FARM_STAFF',
        organizationId: 'farm-org',
      }),
    ).toEqual({ products: [], farms: [], plots: [] });
    expect(db.product.findMany).toHaveBeenCalledWith({
      select: PRODUCT_SELECT,
      orderBy: { productName: 'asc' },
    });
    expect(db.farm.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'farm-org' },
      select: FARM_SELECT,
      orderBy: { name: 'asc' },
    });
    expect(db.plot.findMany).toHaveBeenCalledWith({
      where: { farm: { organizationId: 'farm-org' } },
      select: PLOT_SELECT,
      orderBy: { name: 'asc' },
    });
  });

  it('passes the same product input to Prisma', async () => {
    const { service, db } = fixture();
    const dto = { productName: 'Vegetables', defaultUnit: 'kg' };
    expect(await service.createProduct(dto)).toEqual({ id: 'product' });
    expect(db.product.create).toHaveBeenCalledWith({ data: dto });
  });

  it.each([
    null,
    { type: 'RETAILER', status: 'ACTIVE' },
    { type: 'FARM', status: 'INACTIVE' },
  ])('preserves invalid farm organization rejection', async (organization) => {
    const { service, db } = fixture();
    db.organization.findUnique.mockResolvedValue(organization);
    await expect(
      service.createFarm({ organizationId: 'org', name: 'Farm' }),
    ).rejects.toThrow('Chọn tổ chức nông trại đang hoạt động');
    expect(db.farm.create).not.toHaveBeenCalled();
  });

  it('creates a farm for an active farm organization', async () => {
    const { service, db } = fixture();
    db.organization.findUnique.mockResolvedValue({
      type: 'FARM',
      status: 'ACTIVE',
    });
    const dto = { organizationId: 'org', name: 'Farm' };
    expect(await service.createFarm(dto)).toEqual({ id: 'farm' });
    expect(db.farm.create).toHaveBeenCalledWith({ data: dto });
  });

  it.each([null, { status: 'INACTIVE' }])(
    'preserves plot parent validation',
    async (farm) => {
      const { service, db } = fixture();
      db.farm.findUnique.mockResolvedValue(farm);
      await expect(
        service.createPlot({ farmId: 'farm', name: 'Plot' }),
      ).rejects.toThrow('Chọn nông trại đang hoạt động');
      expect(db.plot.create).not.toHaveBeenCalled();
    },
  );

  it('creates a plot with unchanged decimal input', async () => {
    const { service, db } = fixture();
    db.farm.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    const dto = { farmId: 'farm', name: 'Plot', area: 10.25, unit: 'm2' };
    expect(await service.createPlot(dto)).toEqual({ id: 'plot' });
    expect(db.plot.create).toHaveBeenCalledWith({ data: dto });
  });
});
