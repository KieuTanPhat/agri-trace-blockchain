import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  PublicDirectoryService,
  directoryPage,
} from './public-directory.service.js';
import { PublicEnterprisesQueryDto, PublicProductsQueryDto } from './dto.js';
import {
  publicLotWhere,
  PUBLIC_ENTERPRISE_SELECT,
  PUBLIC_PRODUCT_SELECT,
} from './public-directory.policy.js';

describe('Public directory', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const next = '22222222-2222-4222-8222-222222222222';
  function fixture() {
    const db = {
      product: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      organization: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
      lot: { findMany: vi.fn().mockResolvedValue([]) },
      certificate: { findMany: vi.fn().mockResolvedValue([]) },
    };
    return {
      db,
      service: new PublicDirectoryService(db as unknown as PrismaService),
    };
  }
  it('validates defaults and rejects unbounded/invalid query parameters', async () => {
    expect(plainToInstance(PublicProductsQueryDto, {}).limit).toBe(20);
    expect(
      await validate(
        plainToInstance(PublicProductsQueryDto, { limit: '50', q: ' rau ' }),
      ),
    ).toHaveLength(0);
    for (const input of [
      { limit: 51 },
      { limit: 0 },
      { limit: 1.5 },
      { cursor: 'bad' },
      { q: 'a'.repeat(101) },
      { q: ['bad'] },
    ])
      expect(
        (await validate(plainToInstance(PublicProductsQueryDto, input))).length,
      ).toBeGreaterThan(0);
    expect(
      (
        await validate(
          plainToInstance(PublicEnterprisesQueryDto, { type: 'SYSTEM_ADMIN' }),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
  it('uses QR visibility, active records, stable order and lookahead pagination', async () => {
    const { db, service } = fixture();
    db.product.findMany.mockResolvedValue([{ id }, { id: next }]);
    expect(await service.products({ limit: 1, cursor: id, q: '%' })).toEqual({
      items: [{ id }],
      hasMore: true,
      nextCursor: id,
    });
    expect(db.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: PUBLIC_PRODUCT_SELECT,
        orderBy: { id: 'asc' },
        take: 2,
      }),
    );
    const where = db.product.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).toContain('traceQr');
    expect(JSON.stringify(where)).toContain('ACTIVE');
    expect(JSON.stringify(where)).toContain('\\\\%');
    expect(JSON.stringify(where)).toContain(id);
    await expect(service.products({ limit: 500 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('selects no private enterprise fields and keeps a type/search filter', async () => {
    const { db, service } = fixture();
    await service.enterprises({ limit: 20, type: 'FARM', q: 'A' });
    expect(db.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: PUBLIC_ENTERPRISE_SELECT }),
    );
    const query = JSON.stringify(db.organization.findMany.mock.calls[0][0]);
    expect(query).toContain('shipmentsAsTransporter');
    expect(query).toContain('shipmentsAsRetailer');
    expect(query).not.toContain('chainMemberships');
    expect(query).not.toContain('users');
  });
  it('absent and private detail IDs have the same not-found behavior', async () => {
    const { service } = fixture();
    await expect(service.product(id, { limit: 20 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.enterprise(id, { limit: 20 })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('does not hide recalled/expired lots or certify them by visibility', () => {
    const query = JSON.stringify(publicLotWhere());
    expect(query).not.toContain('currentState');
    expect(query).not.toContain('expiryDate');
  });
  it('produces null terminal cursors, including for empty results', () => {
    expect(directoryPage([], 20)).toEqual({
      items: [],
      hasMore: false,
      nextCursor: null,
    });
    expect(directoryPage([{ id }], 20).nextCursor).toBeNull();
  });
});
