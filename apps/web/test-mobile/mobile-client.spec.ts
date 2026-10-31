import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ randomUUID: vi.fn() }));
vi.mock('../../mobile/node_modules/expo-crypto', () => native);
import { api, newIdempotencyKey } from '../../mobile/src/api/client';

afterEach(() => { vi.unstubAllGlobals(); native.randomUUID.mockReset(); });
describe('native mobile command identifiers', () => {
  it('creates keys through Expo when browser crypto is absent', () => {
    vi.stubGlobal('crypto', undefined);
    native.randomUUID.mockReturnValueOnce('526e0969-8d22-46a2-918b-6f639b40eb24');
    expect(newIdempotencyKey()).toBe('526e0969-8d22-46a2-918b-6f639b40eb24');
    expect(native.randomUUID).toHaveBeenCalledOnce();
  });
  it('preserves an existing key and body when a caller explicitly retries', async () => {
    vi.stubGlobal('crypto', undefined);
    native.randomUUID.mockReturnValue('526e0969-8d22-46a2-918b-6f639b40eb24');
    const fetcher = vi.fn().mockImplementation(async () => new Response(
      JSON.stringify({ success: true, data: { id: 'saved' } }),
      { status: 201, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetcher);
    const key = newIdempotencyKey();
    const body = { version: 3, name: 'Tưới nước' };
    const input = { body, idempotencyKey: key };
    await api('/production-cycles/fixture/care', input);
    await api('/production-cycles/fixture/care', input);
    expect(native.randomUUID).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [, init] of fetcher.mock.calls) {
      expect(init.headers['Idempotency-Key']).toBe(key);
      expect(init.body).toBe(JSON.stringify(body));
    }
  });
});
