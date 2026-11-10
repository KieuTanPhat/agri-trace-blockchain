import { describe, expect, it } from 'vitest';
import { webSecurityHeaders } from './security-headers';

describe('Web browser security policy', () => {
  const headers = Object.fromEntries(webSecurityHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_API_BASE_URL: 'https://agritrace.dev/api' }).map(h => [h.key, h.value]));
  const policy = Object.fromEntries(headers['Content-Security-Policy'].split('; ').map(d => [d.split(' ')[0], d.split(' ').slice(1)]));

  it('restricts injection/embedding and form destinations while allowing PDF and QR camera', () => {
    expect(policy['object-src']).toEqual(["'none'"]);
    expect(policy['frame-ancestors']).toEqual(["'self'"]);
    expect(policy['frame-src']).toContain('blob:');
    expect(policy['form-action']).toEqual(["'self'"]);
    expect(policy['script-src']).not.toContain("'unsafe-eval'");
    expect(policy['script-src']).not.toContain('https:');
    expect(policy['script-src']).not.toContain("'unsafe-inline'");
    expect(policy['style-src']).not.toContain("'unsafe-inline'");
    expect(policy['img-src']).not.toContain('https:');
    expect(policy['img-src']).toContain('https://tile.openstreetmap.org');
    expect(policy['img-src']).toContain('https://vietqr.app');
    expect(policy['script-src']).not.toContain('https://vietqr.app');
    expect(policy['connect-src']).not.toContain('https://vietqr.app');
    expect(policy['connect-src']).not.toContain('ws:');
    expect(headers['Permissions-Policy']).toContain('camera=(self)');
  });

  it('only authorizes inline elements with a valid nonce or exact stylesheet hash', () => {
    const nonce = 'a-valid-request-nonce-123456789';
    const headers = webSecurityHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_CSP_STYLE_HASH: 'A'.repeat(43) + '=' }, nonce);
    const csp = headers.find(h => h.key === 'Content-Security-Policy')!.value;
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).toContain(`style-src 'self' 'nonce-${nonce}' 'sha256-${'A'.repeat(43)}='`);
    expect(csp).toContain("script-src-attr 'none'");
    expect(() => webSecurityHeaders({ NODE_ENV: 'production' }, "bad'; script-src *")).toThrow();
  });

  it('allows the configured API origin but refuses credential-bearing or non-HTTP config', () => {
    expect(policy['connect-src']).toContain('https://agritrace.dev');
    for (const NEXT_PUBLIC_API_BASE_URL of ['javascript:alert(1)', 'https://user:password@example.test/api'])
      expect(() => webSecurityHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_API_BASE_URL })).toThrow();
  });

  it('matches local defaults and same-origin deployment without a wildcard API allowlist', () => {
    const policyFor = (env: NodeJS.ProcessEnv) => webSecurityHeaders(env).find(h => h.key === 'Content-Security-Policy')!.value;
    expect(policyFor({ NODE_ENV: 'production' })).toContain("connect-src 'self' http://localhost:8080");
    expect(policyFor({ NODE_ENV: 'production', NEXT_PUBLIC_API_SAME_ORIGIN: 'true' })).toContain("connect-src 'self';");
    expect(policyFor({ NODE_ENV: 'production', NEXT_PUBLIC_API_BASE_URL: '/api' })).toContain("connect-src 'self';");
  });
});
