import { ConflictException } from '@nestjs/common';
import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService', () => {
  const input = {
    idempotencyKey: 'create-lot-001',
    requesterId: '34695828-dd6f-4463-8607-a9758a2967d6',
    operation: 'CREATE_LOT',
    requestType: 'COMMAND',
    payload: { quantity: 100 },
  };

  function fixture() {
    let record: Record<string, unknown> | null = null;

    const create = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        if (record) throw { code: 'P2002' };

        record = {
          id: 'b9038f8a-5a42-49fc-aa62-93225c5b7994',
          ...data,
          responseStatus: null,
          responseBody: null,
        };
        return record;
      },
    );

    const findUnique = vi.fn(async () => record);

    const update = vi.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        record = { ...record, ...data };
        return record;
      },
    );

    const prisma = {
      idempotencyRecord: { create, findUnique, update },
    };

    return {
      service: new IdempotencyService(
        prisma as unknown as PrismaService,
      ),
      create,
      findUnique,
      update,
    };
  }

  it('returns the saved result without running the command twice', async () => {
    const { service } = fixture();
    const command = vi.fn().mockResolvedValue({ lotId: 'lot-001' });

    const first = await service.execute(input, command);
    const replay = await service.execute(input, command);

    expect(first).toEqual({ lotId: 'lot-001' });
    expect(replay).toEqual(first);
    expect(command).toHaveBeenCalledTimes(1);
  });

  it('rejects the same key when the payload changes', async () => {
    const { service } = fixture();
    const command = vi.fn().mockResolvedValue({ lotId: 'lot-001' });

    await service.execute(input, command);

    await expect(
      service.execute(
        { ...input, payload: { quantity: 200 } },
        command,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(command).toHaveBeenCalledTimes(1);
  });
});