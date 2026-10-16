import { describe, expect, it, vi } from 'vitest';
import { BindingConnectionPool, type BindingTarget } from './binding-pool.js';

const target = { digest: 'a'.repeat(64) } as BindingTarget;

function pool(fingerprint = () => 'fp') {
  const closes: Array<ReturnType<typeof vi.fn>> = [];
  const instance = new BindingConnectionPool();
  const internals = instance as unknown as {
    identityFingerprint: () => Promise<string>;
    connect: (t: unknown, r: unknown, entry: { gateway?: unknown }) => Promise<unknown>;
  };
  internals.identityFingerprint = async () => fingerprint();
  internals.connect = vi.fn(async (_t, _r, entry) => {
    const close = vi.fn();
    closes.push(close);
    entry.gateway = { close };
    return { client: {}, fingerprint: fingerprint(), certificateExpiresAt: new Date() };
  });
  return { instance, closes, connect: internals.connect };
}

describe('BindingConnectionPool lifecycle', () => {
  it('closes every invalidated connection across repeated health failures', async () => {
    const { instance, closes } = pool();
    for (let cycle = 0; cycle < 3; cycle++) {
      const connection = await instance.get(target, 'relayer');
      instance.invalidate(target.digest);
      instance.release(connection);
    }
    expect(closes).toHaveLength(3);
    for (const close of closes) expect(close).toHaveBeenCalledTimes(1);
    expect(instance.openCount()).toBe(0);
  });

  it('keeps an invalidated connection open until its in-flight user releases it', async () => {
    const { instance, closes } = pool();
    const inFlight = await instance.get(target, 'relayer');
    instance.invalidate(target.digest);
    expect(closes[0]).not.toHaveBeenCalled();
    const next = await instance.get(target, 'relayer');
    expect(next).not.toBe(inFlight);
    instance.release(inFlight);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    expect(closes[1]).not.toHaveBeenCalled();
    instance.release(next);
    instance.onModuleDestroy();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it('reuses a cached connection and replaces it after certificate rotation', async () => {
    let fp = 'one';
    const { instance, closes, connect } = pool(() => fp);
    const first = await instance.get(target, 'relayer');
    instance.release(first);
    instance.release(await instance.get(target, 'relayer'));
    expect(connect).toHaveBeenCalledTimes(1);
    fp = 'two';
    const rotated = await instance.get(target, 'relayer');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(closes[0]).toHaveBeenCalledTimes(1);
    instance.release(rotated);
    instance.onModuleDestroy();
    instance.onModuleDestroy();
    expect(closes[1]).toHaveBeenCalledTimes(1);
  });

  it('closes a gateway opened by a connect that failed its capability gate', async () => {
    const { instance, connect } = pool();
    const close = vi.fn();
    vi.mocked(connect).mockImplementationOnce(async (_t, _r, entry) => {
      entry.gateway = { close };
      throw new Error('Binding ledger does not satisfy the writer capability gate');
    });
    await expect(instance.get(target, 'relayer')).rejects.toThrow('capability gate');
    expect(close).toHaveBeenCalledTimes(1);
    expect(instance.openCount()).toBe(0);
  });
});
