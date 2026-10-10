import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext, runInContext, SourceTextModule, SyntheticModule} from 'node:vm';
import test from 'node:test';

// Run the exact concatenated installed scripts with deterministic external I/O.
// A revoked family also invalidates its access JWT, matching the current API.
async function verify({legacy = false, canary = null, requireSessionFamily = false,
  legacyQrLotIds = [], qrLegacy = false, qrWarning = false, timelineWarning = false,
  quantityMismatch = false, sensorOverrides = {}} = {}) {
  const accounts = ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR']
    .map(role => ({role, email: `${role}@test.invalid`, password: 'synthetic-private-password'}));
  const sessions = new Map();
  const output = [];
  const errors = [];
  const calls = [];
  const runtime = {env: {DATABASE_URL: 'postgresql://unused'}, exitCode: 0};
  const event = {event_id: 'event-1', entity_type: 'PRODUCTION_CYCLE', entity_id: 'cycle-1',
    data_hash: 'a'.repeat(64), previous_event_hash: null, immutable_row: '{"event_id":"event-1"}',
    tx_id: 'tx-1', proof_hash: 'a'.repeat(64), channel_id: 'agritrace', transaction_status: 'CONFIRMED', status: 'COMPLETED'};
  const reply = (data, status = 200, cookies = []) => {
    const headers = new Headers({'content-type': 'application/json'});
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return new Response(status === 204 ? null : JSON.stringify({data}), {status, headers});
  };
  const credential = options => {
    if (legacy) return JSON.parse(options.body ?? '{}').refreshToken;
    const cookies = new Map((options.headers?.Cookie ?? '').split('; ').filter(Boolean).map(pair => pair.split('=')));
    return cookies.get(`agritrace_refresh_${cookies.get('agritrace_session')}`);
  };
  const issue = session => {
    const token = `${session.id}_refresh_${++session.rotation}`;
    sessions.set(token, session);
    return {token, data: {accessToken: session.id, ...(legacy ? {refreshToken: token} : {})},
      cookies: legacy ? [] : [`agritrace_refresh_${session.id}=${token}; HttpOnly; Secure`]};
  };
  const fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname;
    calls.push(options.method === 'OPTIONS' ? `OPTIONS ${pathname}` : pathname);
    if (options.method === 'OPTIONS') return new Response(null, {status: 204, headers:
      options.headers.Origin === 'https://agritrace.dev' ? {'access-control-allow-origin': options.headers.Origin,
        'access-control-allow-headers': 'content-type,authorization,idempotency-key'} : {}});
    if (pathname === '/api/auth/login') {
      const account = accounts.find(value => value.email === JSON.parse(options.body).email);
      const id = `00000000-0000-4000-8000-${String(calls.length).padStart(12, '0')}`;
      const session = {id, role: account.role, revoked: false, rotation: 0};
      sessions.set(id, session);
      const auth = issue(session);
      return reply(auth.data, 201, [...(legacy ? [] : [`agritrace_session=${id}; HttpOnly; Secure`]), ...auth.cookies]);
    }
    if (pathname === '/api/auth/refresh') {
      const session = sessions.get(credential(options));
      if (!session || session.revoked) return reply({}, 401);
      const auth = issue(session);
      return reply(auth.data, 201, auth.cookies);
    }
    if (pathname === '/api/auth/logout') {
      const session = sessions.get(credential(options));
      if (session) session.revoked = true;
      return reply({revoked: true}, 201);
    }
    if (pathname === '/api/auth/me' || pathname === '/api/organizations' || pathname.startsWith('/api/blockchain/') || pathname === '/api/production-cycles') {
      const session = sessions.get(options.headers.Authorization?.replace('Bearer ', ''));
      if (!session || (!legacy && session.revoked)) return reply({}, 401);
      if (pathname === '/api/auth/me') return reply({role: {code: session.role}});
      if (pathname === '/api/organizations') return reply({}, 403);
      if (pathname === '/api/production-cycles') return reply({id: 'cycle-1'}, 201);
      return reply({localHashMatches: true, status: 'CONFIRMED', deliveryStatus: 'COMPLETED', txId: event.tx_id});
    }
    if (pathname === '/health/ready') return new Response(JSON.stringify({runtime: {enabled: true, running: true, lastError: null}, backlog: {deadLetter: 0}}));
    if (pathname === '/manifest.webmanifest') return new Response(JSON.stringify({start_url: '/', icons: [{}]}));
    if (pathname === '/api/docs') return reply({}, 404);
    if (pathname === '/api/public/trace/token-1') return reply({lotId: 'lot-1',
      proofStatus: qrLegacy || qrWarning ? 'INTEGRITY_WARNING' : 'VERIFIED',
      warnings: qrLegacy ? ['LEGACY_UNVERIFIED'] : [],
      quantityReconciled: !quantityMismatch, stateReconciled: true,
      sensorEvidence: {status: qrLegacy ? 'LEGACY_UNVERIFIED' : 'FINALIZED', readingCount: 0, digestHash: null,
        periodStart: null, periodEnd: null, finalizedAt: null, ...sensorOverrides},
      timeline: [{proofStatus: timelineWarning ? 'INTEGRITY_WARNING' : 'VERIFIED'}]});
    return reply({});
  };
  const db = {Client: class {
    async connect() {}
    async end() {}
    async query(sql) {
      if (sql.includes('WHERE e.entity_id=$1')) return {rows: [event]};
      if (sql.includes('to_jsonb(e)')) return {rows: [event]};
      if (sql.includes('SELECT lot_id,trace_token')) return {rows: [{lot_id: 'lot-1', trace_token: 'token-1'}]};
      return {rows: [{count: '1'}]};
    }
  }};
  let closed = false;
  let clone;
  const gateway = {loadConfig: () => ({channelName: 'agritrace'}),
    connectGateway: async () => ({gateway: {}, close: () => {closed = true;}}),
    FabricBlockchainAdapter: class {
      async queryEvent() { return {eventId: event.event_id, dataHash: event.data_hash}; }
      async getProof() { return {txId: event.tx_id, dataHash: event.data_hash}; }
      async getEntityHead() { return {eventCount: 1, lastEventId: event.event_id, lastDataHash: event.data_hash}; }
      async queryEntityHistory() { return clone([{eventId: event.event_id}]); }
    }};
  const context = createContext({fetch, process: runtime, AbortSignal,
    console: {log: value => output.push(value), error: value => errors.push(value)}, setTimeout});
  clone = runInContext('value => JSON.parse(JSON.stringify(value))', context);
  const source = ['session-auth.mjs', 'verify.mjs'].map(name => readFileSync(new URL(name, import.meta.url), 'utf8')).join('\n');
  const script = new SourceTextModule(source, {context});
  await script.link(async specifier => {
    const exports = specifier === 'node:fs' ? {readFileSync: () => JSON.stringify({origin: 'https://agritrace.dev', accounts, canary, requireSessionFamily, legacyQrLotIds})} :
      specifier === 'pg' ? {default: db} : specifier.includes('blockchain/gateway/') ? gateway : await import(specifier);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, {context});
  });
  await script.evaluate();
  return {runtime, output, errors, calls, closed};
}

test('historical baseline completes roles, refresh/logout, ledger and QR verification', async () => {
  const result = await verify({legacy: true});
  assert.equal(result.runtime.exitCode, 0, result.errors.join('\n'));
  assert.equal(JSON.parse(result.output[0]).directLedgerEvents, 1);
  assert.equal(result.closed, true);
});

test('current family sessions survive the logout test for subsequent proof verification', async () => {
  const result = await verify({canary: 'b'.repeat(40), requireSessionFamily: true});
  assert.equal(result.runtime.exitCode, 0, result.errors.join('\n'));
  const evidence = JSON.parse(result.output[0]);
  assert.equal(evidence.canary, 'b'.repeat(40));
  assert.equal(evidence.verifiedQR, 1);
  assert.equal(result.closed, true);
  assert.equal(result.calls.filter(path => path === '/api/auth/login').length, 5);
});

test('a candidate returning legacy JSON credentials is rejected before canary writes', async () => {
  const result = await verify({legacy: true, canary: 'b'.repeat(40), requireSessionFamily: true});
  assert.equal(result.runtime.exitCode, 1);
  assert.equal(result.output.length, 0);
  assert.ok(!result.calls.includes('/api/production-cycles'));
  assert.ok(result.errors.every(error => !error.includes('synthetic-private-password')));
});

test('only pre-cutover lots may retain an explicit legacy sensor warning with verified history', async () => {
  const result = await verify({qrLegacy: true, legacyQrLotIds: ['lot-1']});
  assert.equal(result.runtime.exitCode, 0, result.errors.join('\n'));
  const evidence = JSON.parse(result.output[0]);
  assert.equal(evidence.verifiedQR, 0);
  assert.equal(evidence.legacyQR, 1);
  assert.equal(evidence.directLedgerEvents, 1);
});

test('new lots cannot use the legacy warning exception', async () => {
  const result = await verify({qrLegacy: true});
  assert.equal(result.runtime.exitCode, 1);
  assert.equal(result.output.length, 0);
});

test('the legacy exception cannot accept corrupted sensor evidence or a failed event proof', async () => {
  for (const options of [{qrWarning: true}, {qrLegacy: true, timelineWarning: true},
    {qrLegacy: true, quantityMismatch: true}, {qrLegacy: true, sensorOverrides: {readingCount: 1}},
    {qrLegacy: true, sensorOverrides: {periodStart: '2026-10-10T00:00:00.000Z'}},
    {qrLegacy: true, sensorOverrides: {digestHash: 'a'.repeat(64)}}]) {
    const result = await verify({...options, legacyQrLotIds: ['lot-1']});
    assert.equal(result.runtime.exitCode, 1);
    assert.equal(result.output.length, 0);
  }
});

test('a legacy lot cannot silently become fully verified or disappear from the QR catalog', async () => {
  for (const options of [{legacyQrLotIds: ['lot-1']}, {qrLegacy: true, legacyQrLotIds: ['other-lot']}]) {
    const result = await verify(options);
    assert.equal(result.runtime.exitCode, 1);
    assert.equal(result.output.length, 0);
  }
});
