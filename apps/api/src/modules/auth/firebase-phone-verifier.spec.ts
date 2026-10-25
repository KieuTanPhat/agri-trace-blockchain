import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FirebasePhoneVerifier } from './firebase-phone-verifier.js';

describe('Firebase fresh phone proof / real RSA verification', () => {
  let directory: string, key: string, certificate: string;
  const jwt = new JwtService({ secret: 'must-not-be-used-for-firebase' });
  const phone = '+84900000000';
  const project = 'consumer-test-project';
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'acheck-otp-cert-'));
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=consumer-test.invalid',
      ],
      { stdio: 'ignore' },
    );
    key = readFileSync(join(directory, 'key.pem'), 'utf8');
    certificate = readFileSync(join(directory, 'cert.pem'), 'utf8');
  });
  afterAll(() => rmSync(directory, { recursive: true }));
  const make = () =>
    new FirebasePhoneVerifier(
      new ConfigService({ FIREBASE_PROJECT_ID: project }),
      jwt,
      async () => ({
        certificates: { fixture: certificate },
        maxAgeSeconds: 3600,
      }),
    );
  function sign(
    extra: Record<string, unknown> = {},
    opts: Record<string, unknown> = {},
  ) {
    const now = Math.floor(Date.now() / 1000);
    return jwt.sign(
      {
        sub: 'fixture-uid',
        phone_number: phone,
        firebase: { sign_in_provider: 'phone' },
        auth_time: now,
        iat: now,
        exp: now + 3600,
        ...extra,
      },
      {
        secret: key,
        algorithm: 'RS256',
        keyid: 'fixture',
        issuer: `https://securetoken.google.com/${project}`,
        audience: project,
        ...opts,
      },
    );
  }
  it('returns only hashes/expiry, never the raw token; refreshed tokens share the same one-use authentication proof', async () => {
    const verifier = make();
    const token = sign();
    const proof = await verifier.verify(token, phone);
    expect(proof.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(proof)).not.toContain(token);
    const other = await verifier.verify(
      sign({ extra: 'fresh-token-same-phone-auth' }),
      phone,
    );
    expect(other.proofKey).toBe(proof.proofKey);
    expect(other.tokenHash).not.toBe(proof.tokenHash);
  });
  it.each([
    { phone_number: '+84911111111' },
    { firebase: { sign_in_provider: 'password' } },
    { auth_time: Math.floor(Date.now() / 1000) - 301 },
    { iat: Math.floor(Date.now() / 1000) - 301 },
    { auth_time: Math.floor(Date.now() / 1000) + 60 },
    { exp: 1 },
    { sub: '' },
  ])('rejects wrong/stale claim %#', async (extra) => {
    await expect(make().verify(sign(extra), phone)).rejects.toMatchObject({
      status: 401,
    });
  });
  it.each([
    { audience: 'another-project' },
    { issuer: 'https://attacker.invalid' },
    { keyid: 'unknown' },
  ])('rejects trust mismatch %#', async (opts) => {
    await expect(make().verify(sign({}, opts), phone)).rejects.toMatchObject({
      status: 401,
    });
  });
  it('refuses an HS256 forgery using the API JWT secret', async () => {
    await expect(
      make().verify(jwt.sign({ sub: 'x' }), phone),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('fails closed with a sanitized 503 when configuration/cert retrieval is unavailable', async () => {
    const missing = new FirebasePhoneVerifier(new ConfigService(), jwt);
    await expect(missing.verify(sign(), phone)).rejects.toMatchObject({
      status: 503,
    });
    const offline = new FirebasePhoneVerifier(
      new ConfigService({ FIREBASE_PROJECT_ID: project }),
      jwt,
      async () => {
        throw new Error('secret-upstream-detail');
      },
    );
    await expect(offline.verify(sign(), phone)).rejects.toMatchObject({
      status: 503,
    });
  });
});
