import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { BlockchainWorkerRunner } from './blockchain-worker.runner.js';
import type { BindingDeliveryService } from '../ledger/binding-delivery.service.js';

afterEach(() => vi.useRealTimers());

describe('BlockchainWorkerRunner lifecycle', () => {
  it('releases wait listeners between polls and stops promptly', async () => {
    vi.useFakeTimers();
    const processAll = vi.fn().mockResolvedValue({ failedBindings: [] });
    const runner = new BlockchainWorkerRunner(
      {
        get: vi.fn((name: string, fallback: unknown) =>
          name === 'FABRIC_ENABLED'
            ? 'true'
            : name === 'FABRIC_WORKER_INTERVAL_MS'
              ? 10
              : fallback,
        ),
      } as unknown as ConfigService,
      { processAll } as unknown as BindingDeliveryService,
    );
    const listeners = vi.spyOn(AbortSignal.prototype, 'addEventListener');
    runner.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(250);
    expect(processAll.mock.calls.length).toBeGreaterThan(20);
    const signal = listeners.mock.contexts[0] as AbortSignal;
    expect(getEventListeners(signal, 'abort')).toHaveLength(1);
    await runner.onApplicationShutdown();
    expect(getEventListeners(signal, 'abort')).toHaveLength(0);
    expect(runner.getState().running).toBe(false);
    listeners.mockRestore();
  });
});
