import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../mobile/src/api/client';
import { createCommandQueue, type QueuedCommand } from '../../../mobile/src/lib/command-queue';
const storage = vi.hoisted(() => ({ rows: new Map<string, string>() }));
vi.mock('../../../mobile/src/lib/queue', async () => {
  const { createCommandQueue } = await import('../../../mobile/src/lib/command-queue');
  const queue = createCommandQueue({
    getItem: async (key: string) => storage.rows.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.rows.set(key, value); },
  });
  return { enqueue: queue.enqueue, removeQueued: queue.remove, updateQueued: queue.update };
});
import { retryCommand, sendCommand } from '../../../mobile/src/lib/staff-command';

const owner = { id: 'staff', organizationId: 'farm' };
const command = { path: '/production-cycles/cycle/care', body: {
  version: 3, eventTime: '2026-10-31T08:33:00.000Z', eventTimeSource: 'SERVER_RECEIVED',
}, label: 'Tưới nước', detail: 'Bưởi 01' };
const queue = createCommandQueue({
  getItem: async key => storage.rows.get(key) ?? null,
  setItem: async (key, value) => { storage.rows.set(key, value); },
});
async function pending(): Promise<QueuedCommand> {
  await queue.enqueue(owner, { ...command, key: 'original-key' });
  return (await queue.read(owner))[0];
}
beforeEach(() => storage.rows.clear());

describe('Staff journal recovery', () => {
  it('shows a confirmed 422 rejection immediately, keeping the failed command and reason', async () => {
    const call = vi.fn().mockRejectedValueOnce(new ApiError(422, 'Lỗi thời điểm'))
      .mockResolvedValueOnce({ status: 'REJECTED', result: { message: 'Nhanh quá 2 phút' } });
    expect(await sendCommand(call, owner, command)).toMatchObject({ sent: false, state: 'failed', error: 'Nhanh quá 2 phút' });
    expect((await queue.read(owner))[0]).toMatchObject({ state: 'failed', error: 'Nhanh quá 2 phút', body: command.body });
  });
  it('recovers a lost response from the committed journal without a second write', async () => {
    const call = vi.fn().mockRejectedValueOnce(new ApiError(0, 'Mất mạng'))
      .mockResolvedValueOnce({ status: 'COMMITTED', result: { care: 'saved' } });
    expect(await sendCommand(call, owner, command)).toEqual({ sent: true, result: { care: 'saved' } });
    expect(await queue.read(owner)).toEqual([]);
    expect(call.mock.calls.map(([path]) => path)).toEqual([command.path, '/command-requests/status']);
  });
  it.each(['PROCESSING', 'RECONCILIATION_REQUIRED', 'UNKNOWN'])(
    'never executes an unresolved %s command again', async status => {
      const item = await pending();
      const call = vi.fn().mockResolvedValue({ status });
      expect(await retryCommand(call, owner, item)).toMatchObject({ sent: false, state: 'unknown' });
      expect(call).toHaveBeenCalledTimes(1);
      expect((await queue.read(owner))[0].body).toEqual(command.body);
    },
  );
  it('transmits only NOT_FOUND using the exact stored time, source, version and key', async () => {
    const item = await pending();
    const call = vi.fn().mockResolvedValueOnce({ status: 'NOT_FOUND' }).mockResolvedValueOnce({ care: 'saved' });
    expect(await retryCommand(call, owner, item)).toMatchObject({ sent: true });
    expect(call.mock.calls[1]).toEqual([command.path, { body: command.body, idempotencyKey: 'original-key' }]);
    expect(call.mock.calls[0][1].idempotencyKey).toBe('original-key');
    expect(await queue.read(owner)).toEqual([]);
  });
  it('preserves the original command when inspection is unavailable, including a 422 write response', async () => {
    const call = vi.fn().mockRejectedValueOnce(new ApiError(422, 'Lỗi thời điểm')).mockRejectedValueOnce(new ApiError(0, 'Mất mạng'));
    expect(await sendCommand(call, owner, command)).toMatchObject({ sent: false, state: 'unknown' });
    expect((await queue.read(owner))[0].body).toEqual(command.body);
  });
  it('does not execute a rejected command during explicit reconciliation', async () => {
    const item = await pending();
    const call = vi.fn().mockResolvedValue({ status: 'REJECTED', result: { message: 'Trước xuống giống' } });
    expect(await retryCommand(call, owner, item)).toMatchObject({ state: 'failed', error: 'Trước xuống giống' });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('never discloses or executes another account command', async () => {
    const item = await pending(); const call = vi.fn();
    await expect(retryCommand(call, { id: 'other', organizationId: 'farm' }, item)).rejects.toThrow();
    expect(call).not.toHaveBeenCalled();
  });
});
