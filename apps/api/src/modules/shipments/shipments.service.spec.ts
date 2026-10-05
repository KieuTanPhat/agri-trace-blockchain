import {
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import type { Actor } from '../trace/trace.service.js';
import { TraceService } from '../trace/trace.service.js';
import { ShipmentsService } from './shipments.service.js';

describe('ShipmentsService custody and quantity accounting', () => {
  const shipmentId =
    '11111111-1111-1111-1111-111111111111';
  const lotId =
    '22222222-2222-2222-2222-222222222222';
  const farmOrgId =
    '33333333-3333-3333-3333-333333333333';
  const transporterOrgId =
    '44444444-4444-4444-4444-444444444444';
  const retailerOrgId =
    '55555555-5555-5555-5555-555555555555';

  const transporterActor: Actor = {
    sub: '66666666-6666-6666-6666-666666666666',
    organizationId: transporterOrgId,
    role: 'TRANSPORTER',
  };

  const retailerActor: Actor = {
    sub: '77777777-7777-7777-7777-777777777777',
    organizationId: retailerOrgId,
    role: 'RETAILER',
  };

  const farmActor: Actor = {
    sub: '88888888-8888-8888-8888-888888888888',
    organizationId: farmOrgId,
    role: 'FARM_STAFF',
  };

  const shipment = {
    id: shipmentId,
    lotId,
    transporterOrgId,
    retailerOrgId,
    shippedQuantity: new Prisma.Decimal(100),
    damagedQuantity: new Prisma.Decimal(0),
    receivedQuantity: null,
    rejectedQuantity: null,
    status: 'IN_TRANSIT',
    version: 1,
  };

  const lot = {
    id: lotId,
    farmOrgId,
    availableQuantity: new Prisma.Decimal(100),
    initialQuantity: new Prisma.Decimal(100),
    unit: 'kg',
    currentState: 'IN_TRANSPORT',
    version: 1,
  };

  const tx = {
    shipment: {
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    lot: {
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    quantityMovement: {
      create: vi.fn(),
    },
  };

  const prisma = {
    shipment: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  const access = {};

  const trace = {
    createInTransaction: vi.fn(),
  };

  const service = new ShipmentsService(
    prisma as unknown as PrismaService,
    access as OrganizationAccessService,
    trace as unknown as TraceService,
  );

  beforeEach(() => {
    vi.resetAllMocks();

    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
    });

    prisma.$transaction.mockImplementation(
      async (
        callback: (
          transaction: typeof tx,
        ) => Promise<unknown>,
      ) => callback(tx),
    );

    tx.shipment.findUniqueOrThrow.mockResolvedValue({
      ...shipment,
    });

    tx.lot.findUniqueOrThrow.mockResolvedValue({
      ...lot,
    });

    tx.shipment.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.lot.updateMany.mockResolvedValue({
      count: 1,
    });

    tx.quantityMovement.create.mockResolvedValue({});

    trace.createInTransaction.mockResolvedValue({
      id: '99999999-9999-9999-9999-999999999999',
    });
  });

  it('allows transporter to record damage while shipment is in transit', async () => {
    const result = await service.damage(
      shipmentId,
      {
        version: 1,
        lotVersion: 1,
        quantity: 10,
        reason: 'Hư hỏng trong quá trình vận chuyển',
      },
      transporterActor,
    );

    expect(result).toEqual({
      shipmentStatus: 'IN_TRANSIT',
      lotState: 'IN_TRANSPORT',
      availableQuantity: new Prisma.Decimal(90),
      damagedQuantity: new Prisma.Decimal(10),
    });

    expect(tx.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        id: shipmentId,
        version: 1,
        status: 'IN_TRANSIT',
      },
      data: {
        status: 'IN_TRANSIT',
        damagedQuantity: new Prisma.Decimal(10),
        version: {
          increment: 1,
        },
      },
    });

    expect(tx.lot.updateMany).toHaveBeenCalledWith({
      where: {
        id: lotId,
        version: 1,
        currentState: 'IN_TRANSPORT',
      },
      data: {
        currentState: 'IN_TRANSPORT',
        availableQuantity: new Prisma.Decimal(90),
        version: {
          increment: 1,
        },
      },
    });

    expect(tx.quantityMovement.create).toHaveBeenCalledTimes(1);
  });

  it('rejects farm damage through shipment endpoint after handover', async () => {
    await expect(
      service.damage(
        shipmentId,
        {
          version: 1,
          lotVersion: 1,
          quantity: 10,
          reason: 'Trang trại báo hư sau bàn giao',
        },
        farmActor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects retailer damage while transporter still has custody', async () => {
    await expect(
      service.damage(
        shipmentId,
        {
          version: 1,
          lotVersion: 1,
          quantity: 10,
          reason: 'Retailer chưa nhận quyền quản lý',
        },
        retailerActor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects transport damage before shipment starts', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'CREATED',
      version: 0,
    });

    await expect(
      service.damage(
        shipmentId,
        {
          version: 0,
          lotVersion: 0,
          quantity: 10,
          reason: 'Hư trước khi bắt đầu vận chuyển',
        },
        transporterActor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows retailer to record damage after shipment arrives', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 2,
    });

    tx.shipment.findUniqueOrThrow.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 2,
    });

    tx.lot.findUniqueOrThrow.mockResolvedValue({
      ...lot,
      currentState: 'ARRIVED',
      version: 2,
    });

    const result = await service.damage(
      shipmentId,
      {
        version: 2,
        lotVersion: 2,
        quantity: 10,
        reason: 'Phát hiện hư hỏng khi kiểm tra',
      },
      retailerActor,
    );

    expect(result).toEqual({
      shipmentStatus: 'ARRIVED',
      lotState: 'ARRIVED',
      availableQuantity: new Prisma.Decimal(90),
      damagedQuantity: new Prisma.Decimal(10),
    });
  });

  it('rejects transporter damage after retailer receives custody', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 2,
    });

    await expect(
      service.damage(
        shipmentId,
        {
          version: 2,
          lotVersion: 2,
          quantity: 10,
          reason: 'Transporter không còn quyền quản lý',
        },
        transporterActor,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows receiving 90 kg after 10 kg transport damage', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 3,
      damagedQuantity: new Prisma.Decimal(10),
    });

    tx.shipment.findUniqueOrThrow
      .mockResolvedValueOnce({
        ...shipment,
        status: 'ARRIVED',
        version: 3,
        damagedQuantity: new Prisma.Decimal(10),
      })
      .mockResolvedValueOnce({
        ...shipment,
        status: 'DELIVERED',
        version: 4,
        damagedQuantity: new Prisma.Decimal(10),
        receivedQuantity: new Prisma.Decimal(90),
        rejectedQuantity: new Prisma.Decimal(0),
      });

    tx.lot.findUniqueOrThrow.mockResolvedValue({
      ...lot,
      currentState: 'ARRIVED',
      version: 3,
      availableQuantity: new Prisma.Decimal(90),
    });

    const result = await service.receive(
      shipmentId,
      {
        version: 3,
        lotVersion: 3,
        receivedQuantity: 90,
        damagedQuantity: 0,
      },
      retailerActor,
    );

    expect(result.status).toBe('DELIVERED');
    expect(result.receivedQuantity).toEqual(
      new Prisma.Decimal(90),
    );
    expect(result.damagedQuantity).toEqual(
      new Prisma.Decimal(10),
    );

    expect(tx.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        id: shipmentId,
        version: 3,
        status: 'ARRIVED',
      },
      data: expect.objectContaining({
        status: 'DELIVERED',
        receivedQuantity: new Prisma.Decimal(90),
        damagedQuantity: new Prisma.Decimal(10),
        rejectedQuantity: new Prisma.Decimal(0),
      }),
    });
  });

  it('rejects receiving more than quantity remaining', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 3,
      damagedQuantity: new Prisma.Decimal(10),
    });

    tx.shipment.findUniqueOrThrow.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 3,
      damagedQuantity: new Prisma.Decimal(10),
    });

    tx.lot.findUniqueOrThrow.mockResolvedValue({
      ...lot,
      currentState: 'ARRIVED',
      version: 3,
      availableQuantity: new Prisma.Decimal(90),
    });

    await expect(
      service.receive(
        shipmentId,
        {
          version: 3,
          lotVersion: 3,
          receivedQuantity: 91,
          damagedQuantity: 0,
        },
        retailerActor,
      ),
    ).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
    expect(tx.lot.updateMany).not.toHaveBeenCalled();
  });

  it('rejects damage greater than lot remaining quantity', async () => {
    await expect(
      service.damage(
        shipmentId,
        {
          version: 1,
          lotVersion: 1,
          quantity: 101,
          reason: 'Số lượng không hợp lệ',
        },
        transporterActor,
      ),
    ).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );

    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
    expect(tx.lot.updateMany).not.toHaveBeenCalled();
  });

  it('marks shipment and lot failed when all remaining goods are damaged', async () => {
    const result = await service.damage(
      shipmentId,
      {
        version: 1,
        lotVersion: 1,
        quantity: 100,
        reason: 'Hư hỏng toàn bộ',
      },
      transporterActor,
    );

    expect(result).toEqual({
      shipmentStatus: 'FAILED',
      lotState: 'DAMAGED',
      availableQuantity: new Prisma.Decimal(0),
      damagedQuantity: new Prisma.Decimal(100),
    });

    expect(tx.shipment.updateMany).toHaveBeenCalledWith({
      where: {
        id: shipmentId,
        version: 1,
        status: 'IN_TRANSIT',
      },
      data: {
        status: 'FAILED',
        damagedQuantity: new Prisma.Decimal(100),
        version: {
          increment: 1,
        },
      },
    });
  });

  it('rejects receive when quantity conservation does not hold', async () => {
    prisma.shipment.findUnique.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 3,
      damagedQuantity: new Prisma.Decimal(10),
    });

    tx.shipment.findUniqueOrThrow.mockResolvedValue({
      ...shipment,
      status: 'ARRIVED',
      version: 3,
      damagedQuantity: new Prisma.Decimal(10),
    });

    tx.lot.findUniqueOrThrow.mockResolvedValue({
      ...lot,
      currentState: 'ARRIVED',
      version: 3,
      availableQuantity: new Prisma.Decimal(90),
    });

    await expect(
      service.receive(
        shipmentId,
        {
          version: 3,
          lotVersion: 3,
          receivedQuantity: 80,
          damagedQuantity: 0,
        },
        retailerActor,
      ),
    ).rejects.toThrow(
      'Số lượng nhận + hư hỏng mới phải bằng số lượng lô còn lại',
    );

    expect(tx.shipment.updateMany).not.toHaveBeenCalled();
  });
});