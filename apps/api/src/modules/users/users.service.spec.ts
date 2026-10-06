import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { UsersService } from './users.service.js';

vi.mock('bcrypt', () => ({ hash: vi.fn().mockResolvedValue('hash') }));
describe('UsersService master data', () => {
  function setup() {
    const db = {
      user: { findFirst: vi.fn(), create: vi.fn() },
      role: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'role', code: 'FARM_STAFF' }),
      },
      organization: { findFirst: vi.fn() },
    };
    return { db, service: new UsersService(db as unknown as PrismaService) };
  }
  const input = {
    email: ' User@Example.test ',
    fullName: ' User ',
    password: 'password-12345',
    roleCode: 'FARM_STAFF',
    organizationId: 'org',
  };
  it('rejects a missing or inactive organization before creating the user', async () => {
    const { db, service } = setup();
    await expect(service.create(input)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(db.organization.findFirst).toHaveBeenCalledWith({
      where: { id: 'org', status: 'ACTIVE' },
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });
  it('normalizes email/name and maps a concurrent duplicate to a replayable conflict', async () => {
    const { db, service } = setup();
    db.organization.findFirst.mockResolvedValue({ id: 'org' });
    db.user.create.mockRejectedValue({ code: 'P2002' });
    await expect(service.create(input)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(db.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'user@example.test',
          fullName: 'User',
        }),
      }),
    );
  });
});
