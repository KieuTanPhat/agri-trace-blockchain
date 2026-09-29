import { describe, expect, it, vi } from 'vitest';
import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
describe('Idempotency error replay', () => {
  it('replays a failed operation as an HTTP failure without executing it again', async () => {
    const service = new IdempotencyService({} as PrismaService);
    vi.spyOn(service, 'start').mockResolvedValue({
      type: 'REPLAY',
      status: 422,
      body: { message: 'Số lượng không hợp lệ' },
    });
    const command = vi.fn();
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'TEST',
          requestType: 'COMMAND',
          payload: {},
        },
        command,
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(command).not.toHaveBeenCalled();
  });
  it('retains the original business error status', async () => {
    const service = new IdempotencyService({} as PrismaService);
    vi.spyOn(service, 'start').mockResolvedValue({
      type: 'NEW',
      recordId: 'record',
    });
    const fail = vi.spyOn(service, 'fail').mockResolvedValue();
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'TEST',
          requestType: 'COMMAND',
          payload: {},
        },
        async () => {
          throw new UnprocessableEntityException('Không hợp lệ');
        },
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(fail).toHaveBeenCalledWith('record', 422, {
      message: 'Không hợp lệ',
    });
  });
  it('does not mark a committed command as failed if caching its response fails', async () => {
    const service = new IdempotencyService({} as PrismaService);
    vi.spyOn(service, 'start').mockResolvedValue({
      type: 'NEW',
      recordId: 'record',
    });
    vi.spyOn(service, 'complete').mockRejectedValue(
      new Error('connection lost'),
    );
    const fail = vi.spyOn(service, 'fail');
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'TEST',
          requestType: 'COMMAND',
          payload: {},
        },
        async () => ({ id: 'committed' }),
      ),
    ).rejects.toThrow('connection lost');
    expect(fail).not.toHaveBeenCalled();
  });
  it('does not automatically replay an expired request with an unknown outcome', async () => {
    const update = vi.fn();
    const service = new IdempotencyService({
      idempotencyRecord: {
        create: vi.fn().mockRejectedValue({ code: 'P2002' }),
        findUnique: vi
          .fn()
          .mockResolvedValue({
            id: 'record',
            status: 'PROCESSING',
            responseStatus: null,
            requestHash:
              '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
            expiresAt: new Date(0),
          }),
        update,
      },
    } as unknown as PrismaService);
    const command = vi.fn();
    await expect(
      service.execute(
        {
          idempotencyKey: 'key',
          requesterId: 'user',
          operation: 'TEST',
          requestType: 'COMMAND',
          payload: {},
        },
        command,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(command).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
