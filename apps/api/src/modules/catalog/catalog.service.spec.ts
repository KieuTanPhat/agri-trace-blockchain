import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FarmDto, PlotDto, ProductDto } from './catalog.dto.js';
import { CatalogService } from './catalog.service.js';

const admin = { role: 'SYSTEM_ADMIN', organizationId: null };
const staff = { role: 'FARM_STAFF', organizationId: 'org' };
function setup() {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ id: 'created' }),
  });
  const db = {
    organization: model(),
    product: model(),
    farm: model(),
    plot: model(),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((fn) => fn(db));
  return { db, service: new CatalogService(db as unknown as PrismaService) };
}

describe('CatalogService', () => {
  it.each([
    null,
    { type: 'RETAILER', status: 'ACTIVE' },
    { type: 'FARM', status: 'INACTIVE' },
  ])('rejects invalid farm owner %j', async (org) => {
    const { db, service } = setup();
    db.organization.findUnique.mockResolvedValue(org);
    await expect(
      service.createFarm({ organizationId: 'org', name: 'Farm' }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(db.farm.create).not.toHaveBeenCalled();
  });
  it('creates a normalized farm in a serializable transaction', async () => {
    const { db, service } = setup();
    db.organization.findUnique.mockResolvedValue({
      type: 'FARM',
      status: 'ACTIVE',
    });
    await service.createFarm({
      organizationId: 'org',
      name: ' Farm ',
      location: ' ',
    });
    expect(db.farm.create).toHaveBeenCalledWith({
      data: { organizationId: 'org', name: 'Farm', location: null },
    });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
  it.each([
    null,
    { status: 'INACTIVE' },
    { status: 'ACTIVE', organization: { status: 'INACTIVE', type: 'FARM' } },
    { status: 'ACTIVE', organization: { status: 'ACTIVE', type: 'RETAILER' } },
  ])('rejects invalid plot parent %j', async (farm) => {
    const { db, service } = setup();
    db.farm.findUnique.mockResolvedValue(farm);
    await expect(
      service.createPlot({ farmId: 'farm', name: 'Plot' }, admin),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(db.plot.create).not.toHaveBeenCalled();
  });
  it('rejects a foreign farm before inserting a plot', async () => {
    const { db, service } = setup();
    db.farm.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      organizationId: 'foreign',
      organization: { status: 'ACTIVE', type: 'FARM' },
    });
    await expect(
      service.createPlot({ farmId: 'farm', name: 'Plot' }, staff),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.plot.create).not.toHaveBeenCalled();
  });
  it('creates a plot with decimal area and normalized optional text', async () => {
    const { db, service } = setup();
    db.farm.findUnique.mockResolvedValue({
      status: 'ACTIVE',
      organizationId: 'org',
      organization: { status: 'ACTIVE', type: 'FARM' },
    });
    await service.createPlot(
      { farmId: 'farm', name: ' Plot ', area: 1.25, unit: ' ha ' },
      admin,
    );
    expect(db.plot.create).toHaveBeenCalledWith({
      data: {
        farmId: 'farm',
        name: 'Plot',
        area: 1.25,
        unit: 'ha',
        location: null,
      },
    });
  });
  it.each(['product', 'farm', 'plot'] as const)(
    'rejects duplicate %s without inserting',
    async (model) => {
      const { db, service } = setup();
      db.organization.findUnique.mockResolvedValue({
        type: 'FARM',
        status: 'ACTIVE',
      });
      db.farm.findUnique.mockResolvedValue({
        status: 'ACTIVE',
        organization: { type: 'FARM', status: 'ACTIVE' },
      });
      db[model].findFirst.mockResolvedValue({ id: 'existing' });
      const result =
        model === 'product'
          ? service.createProduct({ productName: 'Rice' })
          : model === 'farm'
            ? service.createFarm({ organizationId: 'org', name: 'Farm' })
            : service.createPlot({ farmId: 'farm', name: 'Plot' }, admin);
      await expect(result).rejects.toBeInstanceOf(ConflictException);
      expect(db[model].create).not.toHaveBeenCalled();
    },
  );
  it.each(['P2002', 'P2034'])(
    'turns %s into a replayable HTTP conflict',
    async (code) => {
      const { db, service } = setup();
      db.$transaction.mockRejectedValue({ code });
      await expect(
        service.createProduct({ productName: 'Rice' }),
      ).rejects.toBeInstanceOf(ConflictException);
    },
  );
  it('scopes staff lists to active owned farms and active references', async () => {
    const { db, service } = setup();
    await service.list(staff);
    expect(db.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org',
          status: 'ACTIVE',
          organization: { type: 'FARM', status: 'ACTIVE' },
        },
      }),
    );
    expect(db.plot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'ACTIVE',
          farm: expect.objectContaining({ organizationId: 'org' }),
        }),
      }),
    );
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });
  it('retains inactive records in admin lists', async () => {
    const { db, service } = setup();
    await service.list(admin);
    expect(db.farm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
  it('fails closed for staff without an organization', async () => {
    const { service } = setup();
    await expect(
      service.list({ ...staff, organizationId: null }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('Catalog DTOs', () => {
  const farmId = '631e9648-174d-48a0-9494-353bda8775da';
  it.each([0, -1, 1.001, 10000000000, 'oops', ''])(
    'rejects area %j outside Decimal(12,2)',
    async (area) => {
      expect(
        await validate(
          plainToInstance(PlotDto, { farmId, name: 'Plot', area }),
        ),
      ).not.toHaveLength(0);
    },
  );
  it.each([null, undefined, 0.01, '1.25', 9999999999.99])(
    'accepts optional/valid area %j',
    async (area) => {
      expect(
        await validate(
          plainToInstance(PlotDto, { farmId, name: 'Plot', area }),
        ),
      ).toHaveLength(0);
    },
  );
  it('normalizes optional strings and rejects whitespace-only required names', async () => {
    const dto = plainToInstance(ProductDto, {
      productName: ' Rice ',
      variety: ' ',
      defaultUnit: null,
    });
    expect(dto).toMatchObject({
      productName: 'Rice',
      variety: null,
      defaultUnit: null,
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(
      await validate(
        plainToInstance(FarmDto, { organizationId: farmId, name: ' ' }),
      ),
    ).not.toHaveLength(0);
  });
});
