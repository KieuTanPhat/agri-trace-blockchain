import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { IdempotencyService } from './idempotency.service.js';
import { commandTransaction } from './command-transaction.js';

function known(code: string) {
  return new Prisma.PrismaClientKnownRequestError(`constraint ${code}`, {
    code,
    clientVersion: 'test',
  });
}

describe('Rolled-back constraint errors inside a command transaction', () => {
  it.each([
    ['P2002', 409],
    ['P2003', 409],
    ['P2025', 404],
    ['P2004', 422],
  ])('records %s raised in the callback as a terminal %i rejection', async (code, status) => {
    const prisma = {
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    } as unknown as PrismaService;
    const service = new IdempotencyService(prisma);
    vi.spyOn(service, 'start').mockResolvedValue({ type: 'NEW', recordId: 'r' });
    const fail = vi.spyOn(service, 'fail').mockResolvedValue();
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'CREATE_CYCLE',
          requestType: 'COMMAND',
          payload: {},
        },
        () =>
          commandTransaction(prisma, () => {
            throw known(code);
          }),
      ),
    ).rejects.toMatchObject({ status });
    expect(fail).toHaveBeenCalledWith('r', status, expect.any(Object));
  });

  it('keeps an error from COMMIT itself as an unknown outcome', async () => {
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        await fn({});
        throw known('P2002');
      }),
    } as unknown as PrismaService;
    const service = new IdempotencyService(prisma);
    vi.spyOn(service, 'start').mockResolvedValue({ type: 'NEW', recordId: 'r' });
    const fail = vi.spyOn(service, 'fail').mockResolvedValue();
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'CREATE_CYCLE',
          requestType: 'COMMAND',
          payload: {},
        },
        () => commandTransaction(prisma, async () => ({ id: 'x' })),
      ),
    ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(fail).not.toHaveBeenCalled();
  });

  it('does not wrap infrastructure errors raised in the callback', async () => {
    const prisma = {
      $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn({})),
    } as unknown as PrismaService;
    const error = new Error('connection reset');
    await expect(
      commandTransaction(prisma, () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});
