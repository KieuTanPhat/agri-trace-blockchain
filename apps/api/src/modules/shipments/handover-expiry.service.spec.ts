import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { HandoverExpiryService } from './handover-expiry.service.js';

describe('Bounded handover expiry reconciliation', () => {
  it('rechecks under lot -> handover locks and does not expire a concurrently confirmed offer', async () => {
    const id = '87c08d57-e4e4-455d-825c-a42a34ee83e8';
    const order: string[] = [];
    const updateMany = vi.fn();
    const tx = {
      $executeRaw: vi.fn(() => { order.push('lot'); }),
      $queryRaw: vi.fn(() => { order.push('handover'); }),
      shipmentHandover: { findUnique: vi.fn().mockResolvedValue({ id, state: 'CONFIRMED', version: 2 }), updateMany },
    };
    const findMany = vi.fn().mockResolvedValue([{ id, shipment: { lotId: '7545fbb8-c257-4a2b-b627-95992c65b888' } }]);
    const prisma = { shipmentHandover: { findMany }, $transaction: vi.fn((work: (db: typeof tx) => unknown) => work(tx)) };
    const service = new HandoverExpiryService(prisma as unknown as PrismaService);
    expect(await service.expireDue(undefined, 10)).toBe(0);
    expect(order).toEqual(['lot', 'handover']);
    expect(updateMany).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });
  it('counts actual expirations and updates only the offer terminal state with version CAS', async () => {
    const id = '87c08d57-e4e4-455d-825c-a42a34ee83e8';
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn(),
      shipmentHandover: { findUnique: vi.fn().mockResolvedValue({ id, state: 'OFFERED', expiresAt: new Date(0), version: 1 }), updateMany } };
    const prisma = { shipmentHandover: { findMany: vi.fn().mockResolvedValue([{ id, shipment: { lotId: '7545fbb8-c257-4a2b-b627-95992c65b888' } }]) },
      $transaction: vi.fn((work: (db: typeof tx) => unknown) => work(tx)) };
    expect(await new HandoverExpiryService(prisma as unknown as PrismaService).expireDue()).toBe(1);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id, version: 1, state: 'OFFERED' }),
      data: { state: 'EXPIRED', resolvedAt: expect.any(Date), reason: 'Hết hạn chờ xác nhận', version: { increment: 1 } } }));
  });
});
