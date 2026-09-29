import { describe, expect, it, vi } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
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
});
