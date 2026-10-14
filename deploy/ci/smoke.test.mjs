import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runSmoke } from './smoke.mjs';

const origin = 'http://127.0.0.1:18080';
const lotId = '00000000-0000-4000-8000-000000000001';
const traceToken = 'restored-qr-fixture';
const fixture = {
  accounts: ['SYSTEM_ADMIN', 'FARM_STAFF'].map(role => ({
    role, email: `${role.toLowerCase()}@rehearsal.example.test`, password: 'fixture-only-password',
  })),
};

function restoredApi(t, lot) {
  const reads = [];
  const response = (data, status = 200, cookies = false) => new Response(JSON.stringify({ data }), {
    status,
    headers: [
      ['Content-Type', 'application/json'],
      ...(cookies ? [
        ['Set-Cookie', 'agritrace_session=00000000-0000-4000-8000-000000000002; HttpOnly'],
        ['Set-Cookie', 'agritrace_refresh_00000000-0000-4000-8000-000000000002=fixture-refresh; HttpOnly'],
      ] : []),
    ],
  });
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = new URL(url);
    assert.equal(target.origin, origin);
    const route = target.pathname;
    if (route === '/login' || route === '/api/health') return response({});
    if (route === '/api/docs') return response({}, 404);
    if (route === '/api/auth/login') {
      assert.equal(options.method, 'POST');
      const credentials = JSON.parse(options.body);
      const account = fixture.accounts.find(item => item.email === credentials.email);
      assert.ok(account);
      assert.equal(credentials.password, account.password);
      return response({ accessToken: `fixture-access-${account.role}` }, 201, true);
    }
    const authorization = options.headers?.Authorization;
    if (route === '/api/auth/me') {
      const role = authorization?.replace('Bearer fixture-access-', '');
      assert.ok(fixture.accounts.some(account => account.role === role));
      return response({ role: { code: role } });
    }
    assert.equal(options.method, 'GET');
    reads.push(route);
    if (route === `/api/lots/${lotId}`) {
      assert.equal(authorization, 'Bearer fixture-access-FARM_STAFF');
      return response(lot);
    }
    if (route === `/api/public/trace/${traceToken}`) return response({ lotId, proofStatus: 'PENDING' });
    throw new Error(`Unexpected rehearsal request: ${route}`);
  });
  return reads;
}

const restoredOptions = { origin, fixture, full: false, expectedLots: [lotId], expectedTraceTokens: [traceToken] };

test('post-restore smoke reads the InternalLotDto lotId and checks restored public QR', async t => {
  const reads = restoredApi(t, { lotId, lotCode: 'RESTORED' });
  const result = await runSmoke(restoredOptions);
  assert.equal(result.restoredLots, 1);
  assert.equal(result.restoredTokens, 1);
  assert.deepEqual(reads, [`/api/lots/${lotId}`, `/api/public/trace/${traceToken}`]);
});

test('post-restore smoke rejects a different lotId even when an id alias matches', async t => {
  restoredApi(t, { lotId: '00000000-0000-4000-8000-000000000003', id: lotId });
  await assert.rejects(runSmoke(restoredOptions), /A restored lot is unavailable/);
});
