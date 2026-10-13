import { ServiceUnavailableException, type CallHandler, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';
import { MaintenanceWriteInterceptor } from './maintenance-write.interceptor.js';

const ACTOR = '10000000-0000-4000-8000-000000000001';
function fixture(values: Record<string, string> = {}) {
  const config = { get: (key: string) => values[key] } as ConfigService;
  const interceptor = new MaintenanceWriteInterceptor(config);
  const next = { handle: vi.fn(() => of({ committed: true })) } as CallHandler & { handle: ReturnType<typeof vi.fn> };
  const call = (method: string, path: string, user?: { sub: string }, body?: unknown) => {
    const request = { method, originalUrl: path, user, body };
    return interceptor.intercept({ getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext, next);
  };
  return { call, next };
}

describe('Maintenance protects cutover writers', () => {
  it('holds production writes by default before entering the handler', () => {
    const { call, next } = fixture({ NODE_ENV: 'production' });
    expect(() => call('POST', '/api/shipments/x/handovers/offer')).toThrow(ServiceUnavailableException);
    expect(next.handle).not.toHaveBeenCalled();
  });
  it('allows read/reconciliation and session cleanup while writers are held', () => {
    const { call, next } = fixture({ HYBRID_WRITES_MODE: 'CLOSED' });
    call('GET', '/api/lots');
    call('POST', '/api/command-requests/status?ignored=true');
    call('POST', '/api/auth/logout');
    expect(next.handle).toHaveBeenCalledTimes(3);
  });
  it('uses authenticated actor identity rather than submitted actor fields', () => {
    const { call, next } = fixture({ HYBRID_WRITES_MODE: 'CANARY', HYBRID_CANARY_ACTOR_IDS: ACTOR });
    expect(() => call('POST', '/api/production-cycles', undefined, { sub: ACTOR })).toThrow(ServiceUnavailableException);
    expect(next.handle).not.toHaveBeenCalled();
    call('POST', '/api/production-cycles', { sub: ACTOR });
    expect(next.handle).toHaveBeenCalledTimes(1);
  });
  it('fails closed for an invalid mode or malformed canary catalog', () => {
    expect(() => fixture({ HYBRID_WRITES_MODE: 'open' }).call('PATCH', '/api/users/x')).toThrow(ServiceUnavailableException);
    expect(() => fixture({ HYBRID_WRITES_MODE: 'CANARY', HYBRID_CANARY_ACTOR_IDS: ACTOR + ',*' })
      .call('POST', '/api/lots', { sub: ACTOR })).toThrow(ServiceUnavailableException);
  });
});
