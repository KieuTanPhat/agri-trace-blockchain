import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { OrganizationsService } from './organizations.service.js';

describe('OrganizationsService duplicate protection', () => {
  it('rejects a normalized duplicate inside a serializable transaction', async () => {
    const organization = {
      findFirst: vi.fn().mockResolvedValue({ id: 'existing' }),
      create: vi.fn(),
    };
    const db = { $transaction: vi.fn((fn) => fn({ organization })) };
    const service = new OrganizationsService(db as unknown as PrismaService);
    await expect(
      service.create({ name: ' Farm ', type: 'FARM' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(organization.findFirst).toHaveBeenCalledWith({
      where: { name: 'Farm', type: 'FARM' },
    });
    expect(organization.create).not.toHaveBeenCalled();
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
  });
});
