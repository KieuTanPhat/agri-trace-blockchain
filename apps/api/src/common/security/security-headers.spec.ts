import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { securityHeaders } from './security-headers.js';
import { Logger } from '@nestjs/common';
import { RequestIdMiddleware } from '../request/request-id.middleware.js';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

function server() {
  const app = express();
  app.use(securityHeaders, express.json({ limit: '1kb' }));
  app.all('/api/auth/login', (_req, res) => res.status(401).json({ error: 'denied' }));
  return app;
}

describe('API HTTP security boundary', () => {
  it('protects denied/private responses and does not expose Express or trust spoofed HTTPS', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const response = await request(server()).get('/api/auth/login').set('X-Forwarded-Proto', 'https');
    expect(response.status).toBe(401);
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['strict-transport-security']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('keeps headers on malformed JSON and oversized request errors', async () => {
    for (const [payload, status] of [['{', 400], [JSON.stringify({ padding: 'x'.repeat(2048) }), 413]] as const) {
      const response = await request(server()).post('/api/auth/login').type('json').send(payload);
      expect(response.status).toBe(status);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['cache-control']).toBe('no-store');
    }
  });

  it('does not reflect oversized/untrusted request IDs or put query secrets into logs', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const app = express();
    const middleware = new RequestIdMiddleware();
    app.use((req, res, next) => middleware.use(req, res, next));
    app.get('/api/auth/me', (_req, res) => res.json({ ok: true }));
    const response = await request(app).get('/api/auth/me?token=secret-sentinel').set('X-Request-Id', 'x'.repeat(200));
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-sentinel');
    expect(log).toHaveBeenCalledWith('HTTP request completed', expect.objectContaining({ path: '/api/auth/me' }));
  });
});
