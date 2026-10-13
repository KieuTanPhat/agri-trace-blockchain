// Installed controller helper. Run once per release in an administrative
// container; private smoke keys and command receipts stay in a root-only mount.
import assert from 'node:assert/strict';
import { readFileSync, openSync, closeSync, writeFileSync, fsyncSync, renameSync, existsSync, unlinkSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './apps/api/dist/generated/prisma/client.js';
import { generateSignerKey, registrationBody, signPreparedIntent } from './apps/api/dist/modules/signing/org-signer.js';
import { verifyStoredEvidence } from './apps/api/dist/modules/trace/event-evidence.js';
import { connectGateway, BindingLedgerClient } from './blockchain/gateway/dist/index.js';

const input = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(input.environment, 'production');
assert.match(input.sha, /^[a-f0-9]{40}$/);
assert.ok(['enroll', 'verify', 'read'].includes(input.stage));
const filename = '/smoke/state.json';
const state = JSON.parse(readFileSync(filename, 'utf8'));
assert.equal(state.sha, input.sha);
assert.equal(state.chainId, input.catalog.chainId);
const persist = () => {
  const file = filename + '.tmp';
  writeFileSync(file, JSON.stringify(state) + '\n', { mode: 0o600 });
  const fd = openSync(file, 'r'); try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(file, filename);
  const directory = openSync('/smoke', 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
};
const tokens = {}, sessions = {}, refresh = [];
const accounts = Object.fromEntries(input.accounts.map(a => [a.role, a]));
const authFile = '/smoke/auth-session.json';
const cachedAuth = existsSync(authFile) ? JSON.parse(readFileSync(authFile, 'utf8')) : {};
let phase = 'health', connection;
const db = new pg.Client({ connectionString: input.databaseUrl });
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.databaseUrl }) });
async function http(route, role, body, expected = body === undefined ? 200 : 201, key, options = {}) {
  const response = await fetch(input.origin + '/api' + route, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30_000),
    headers: { ...(role ? { Authorization: 'Bearer ' + tokens[role] } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}), ...(options.cookie ? { Cookie: options.cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(response.status, expected, `HTTP ${route} status ${response.status}`);
  const data = (await response.json()).data;
  if (options.session) options.session(readSessionCredential(response, data, options.previous, true));
  return data;
}
async function command(name, role, route, createBody, expected = 201) {
  // Save before sending. A timeout can never create another key or payload.
  let saved = state.commands[name];
  if (!saved) {
    saved = state.commands[name] = { role, route, key: randomUUID(), body: createBody(), expected };
    persist();
  }
  assert.equal(saved.role, role); assert.equal(saved.route, route); assert.equal(saved.expected, expected);
  if (Object.hasOwn(saved, 'result')) return saved.result;
  const result = await http(route, role, saved.body, expected, saved.key);
  saved.result = result ?? null; persist(); return saved.result;
}
async function wait(predicate, label) {
  const deadline = Date.now() + 240_000;
  do { if (await predicate()) return; await delay(1500); } while (Date.now() < deadline);
  throw Error(label + ' did not settle');
}
try {
  assert.equal((await fetch(input.origin + '/login')).status, 200);
  assert.equal((await fetch(input.origin + '/api/docs')).status, 404);
  await http('/health');
  const response = await fetch(input.workerReadyUrl);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.runtime.enabled, true); assert.equal(health.runtime.running, true);
  assert.equal(health.runtime.lastError, null); assert.equal(health.backlog.deadLetter, 0);
  phase = 'authentication';
  const loginRoles = input.stage === 'enroll' ? ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'] : ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR'];
  for (const role of loginRoles) {
    const previous = cachedAuth[role];
    if (previous?.email === accounts[role].email && previous.expires > Date.now()) {
      tokens[role] = previous.token; sessions[role] = previous.session; refresh.push(previous.session);
    } else {
      const auth = await http('/auth/login', undefined, { email: accounts[role].email, password: accounts[role].password }, 201, undefined,
        { session: credential => { sessions[role] = credential; refresh.push(credential); } });
      tokens[role] = auth.accessToken;
      cachedAuth[role] = { email: accounts[role].email, token: auth.accessToken, session: sessions[role], expires: Date.now() + 20 * 60_000 };
    }
    assert.equal((await http('/auth/me', role)).role.code, role);
  }
  if (input.stage === 'enroll') writeFileSync(authFile, JSON.stringify(cachedAuth), { mode: 0o600 });
  await db.connect();
  const profile = (await db.query('SELECT chain_ref,active_binding_digest,handover_mode FROM chain_ledger_profile WHERE chain_id=$1', [input.catalog.chainId])).rows[0];
  assert.ok(profile?.active_binding_digest);
  if (input.stage === 'enroll') {
    phase = 'organization-key-enrollment';
    for (const role of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER']) {
      if (!state.keys[role]) { state.keys[role] = { ...generateSignerKey(), keyRef: randomUUID() }; persist(); }
      const key = state.keys[role];
      await command('key-' + role, role, `/supply-chains/${state.chainId}/signing-keys`, () => registrationBody(key.privatePem,
        { bindingDigest: profile.active_binding_digest, organizationId: accounts[role].organizationId, keyRef: key.keyRef, label: 'Technical production smoke ' + input.sha.slice(0, 12) }));
    }
    console.log(JSON.stringify({ result: 'passed', keyRefs: Object.values(state.keys).map(k => k.keyRef) }));
  } else {
    phase = 'roles-and-session';
    const deniedBody = { ...input.catalog, cycleCode: 'Forbidden smoke', maxHarvestQuantity: 1, harvestUnit: 'kg' };
    for (const role of ['SYSTEM_ADMIN', 'AUDITOR']) await http('/production-cycles', role, deniedBody, 403, randomUUID());
    const request = sessionRequest(sessions.AUDITOR);
    let rotated;
    const auth = await http('/auth/refresh', undefined, request.body, 201, undefined,
      { cookie: request.cookie, previous: sessions.AUDITOR, session: credential => { rotated = credential; refresh.push(credential); } });
    tokens.LIFECYCLE = auth.accessToken;
    const logout = sessionRequest(rotated);
    await http('/auth/logout', undefined, logout.body, 201, undefined, { cookie: logout.cookie });
    await http('/auth/me', 'LIFECYCLE', undefined, 401);
    await http('/auth/refresh', undefined, logout.body, 401, undefined, { cookie: logout.cookie });
    phase = 'cors-and-web';
    for (const origin of [...input.corsOrigins, 'https://unapproved.example']) {
      const preflight = await fetch(input.origin + '/api/auth/login', { method: 'OPTIONS', headers: { Origin: origin,
        'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,authorization,idempotency-key' } });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('access-control-allow-origin'), input.corsOrigins.includes(origin) ? origin : null);
    }
    for (const asset of ['/manifest.webmanifest', '/sw.js']) assert.equal((await fetch(input.origin + asset)).status, 200);
    if (input.stage === 'verify') {
      assert.equal(profile.handover_mode, 'DUAL_SIGNED');
      phase = 'business-lifecycle';
      await wait(async () => Number((await db.query(`SELECT count(*) FROM ledger_permission_sync s JOIN ledger_permission p USING(permission_ref)
        WHERE p.binding_digest=$1 AND s.state <> 'ACTIVE'`, [profile.active_binding_digest])).rows[0].count) === 0, 'Permission synchronization');
      const cycle = await command('cycle', 'FARM_STAFF', '/production-cycles', () => ({ ...input.catalog, cycleCode: 'Smoke-' + input.sha.slice(0, 20), maxHarvestQuantity: 2, harvestUnit: 'kg' }));
      await command('plant', 'FARM_STAFF', `/production-cycles/${cycle.id}/plant`, () => ({ version: 0, plantedAt: new Date(Date.now() - 60_000).toISOString() }));
      await command('care', 'FARM_STAFF', `/production-cycles/${cycle.id}/care`, () => ({ version: 1, careType: 'WATERING', eventTime: new Date().toISOString(), note: 'Technical acceptance' }));
      const harvest = await command('harvest', 'FARM_STAFF', `/production-cycles/${cycle.id}/harvests`, () => ({ quantity: 2, unit: 'kg', harvestTime: new Date().toISOString() }));
      const plan = await command('plan', 'FARM_STAFF', `/supply-chains/${state.chainId}/shipment-plans`, () => ({ lotId: harvest.lot.id,
        transporterOrgId: accounts.TRANSPORTER.organizationId, retailerOrgId: accounts.RETAILER.organizationId,
        quantity: '2.000', unit: 'kg', origin: 'Technical farm', destination: 'Technical retailer' }));
      for (const [party, role] of [['PRODUCER', 'FARM_STAFF'], ['TRANSPORTER', 'TRANSPORTER'], ['RETAILER', 'RETAILER']])
        await command('accept-' + party, role, `/supply-chains/${state.chainId}/shipment-plans/${plan.id}/accept`, () => ({ party, revision: plan.currentRevision, payloadDigest: plan.current.payloadDigest }));
      const finalized = await command('finalize', 'FARM_STAFF', `/supply-chains/${state.chainId}/shipment-plans/${plan.id}/finalize`, () => ({ version: plan.version }));
      for (const [kind, giver, receiver] of [['PICKUP', 'FARM_STAFF', 'TRANSPORTER'], ['ARRIVAL', 'TRANSPORTER', 'RETAILER']]) {
        const offer = await command(kind + '-prepare-offer', giver, `/shipments/${finalized.shipmentId}/handover-offers/intent`, () => ({ kind, keyRef: state.keys[giver].keyRef, preparationRef: randomUUID(), signingWindowMinutes: 1440 }));
        const expected = role => ({ chainRef: profile.chain_ref, bindingDigest: profile.active_binding_digest, signerOrgRef: accounts[role].organizationId,
          keyRef: state.keys[role].keyRef, entityType: 'SHIPMENT', entityId: finalized.shipmentId });
        assert.equal(offer.payload.quantity, '2.000'); assert.equal(offer.payload.kind, kind);
        assert.equal(offer.payload.giverOrgId, accounts[giver].organizationId); assert.equal(offer.payload.receiverOrgId, accounts[receiver].organizationId);
        const handover = await command(kind + '-offer', giver, `/signing-intents/${offer.intentId}/submit`, () => ({ signature: signPreparedIntent(state.keys[giver].privatePem, offer, Date.now(), { ...expected(giver), operation: 'HANDOVER_OFFER' }).signature }));
        const confirm = await command(kind + '-prepare-confirm', receiver, `/handovers/${handover.id}/confirmation/intent`, () => ({ keyRef: state.keys[receiver].keyRef, preparationRef: randomUUID(), signingWindowMinutes: 1440 }));
        assert.equal(confirm.payload.handoverId, handover.id);
        const result = await command(kind + '-confirm', receiver, `/signing-intents/${confirm.intentId}/submit`, () => ({ signature: signPreparedIntent(state.keys[receiver].privatePem, confirm, Date.now(), { ...expected(receiver), operation: 'HANDOVER_CONFIRM' }).signature }));
        assert.equal(result.state, 'CONFIRMED'); assert.equal(result.custodyLabel, 'CROSS_ORG');
      }
      const versions = (await db.query('SELECT s.version,l.version AS lot_version FROM shipment s JOIN lot l USING(lot_id) WHERE s.shipment_id=$1', [finalized.shipmentId])).rows[0];
      await command('receive', 'RETAILER', `/shipments/${finalized.shipmentId}/receive`, () => ({ version: versions.version, lotVersion: versions.lot_version, receivedQuantity: 2, damagedQuantity: 0 }));
      // A completed request can be replayed with its original key and payload.
      const saved = state.commands.harvest;
      assert.deepEqual(await http(saved.route, saved.role, saved.body, saved.expected, saved.key), saved.result);
    }
    phase = 'outbox-and-stored-evidence';
    await wait(async () => Number((await db.query(`SELECT count(*) FROM trace_event e LEFT JOIN blockchain_outbox o USING(event_id)
      LEFT JOIN blockchain_proof p USING(event_id) WHERE o.status IS DISTINCT FROM 'COMPLETED' OR p.transaction_status IS DISTINCT FROM 'CONFIRMED'`)).rows[0].count) === 0, 'Outbox');
    const report = await verifyStoredEvidence(prisma);
    assert.equal(report.failed.length, 0);
    const reference = input.connection;
    connection = await connectGateway({ channelName: input.channel, chaincodeName: input.chaincode, contractName: 'AgriTraceContract',
      mspId: reference.mspId, peerEndpoint: reference.peerEndpoint, peerHostAlias: reference.peerHostAlias,
      tlsCertPath: reference.tlsCertPath, identityCertPath: reference.certPath, identityKeyDirectory: reference.keyDir });
    const ledger = new BindingLedgerClient(connection.gateway, { channelName: input.channel, chaincodeName: input.chaincode, contractName: 'AgriTraceContract' });
    const events = (await db.query(`SELECT e.event_id,e.data_hash,e.previous_event_hash,e.entity_type,e.entity_id,to_jsonb(e)::text AS immutable_row,
      p.tx_id,p.channel_id,d.chain_ref FROM trace_event e JOIN blockchain_proof p USING(event_id) JOIN event_ledger_route r USING(event_id)
      JOIN ledger_route_definition d ON d.digest=r.definition_digest ORDER BY e.created_at,e.event_id`)).rows;
    assert.ok(events.length > 0 && events.length <= 10000);
    const fingerprints = {};
    for (const event of events) {
      const [actual, proof, status, apiProof] = await Promise.all([ledger.queryBindingEvent(event.chain_ref, event.event_id),
        ledger.getBindingProof(event.chain_ref, event.event_id), ledger.transactionValidationCode(event.tx_id), http(`/blockchain/events/${event.event_id}/verify`, 'FARM_STAFF')]);
      assert.equal(actual.eventId, event.event_id); assert.equal(actual.dataHash, event.data_hash);
      assert.equal(actual.previousEventHash ?? null, event.previous_event_hash ?? null);
      assert.equal(proof.txId, event.tx_id); assert.equal(proof.dataHash, event.data_hash); assert.equal(status, 0);
      assert.equal(event.channel_id, input.channel); assert.equal(apiProof.localHashMatches, true);
      assert.equal(apiProof.status, 'CONFIRMED'); assert.equal(apiProof.deliveryStatus, 'COMPLETED'); assert.equal(apiProof.txId, event.tx_id);
      fingerprints['event:' + event.event_id] = createHash('sha256').update(event.immutable_row).digest('hex');
      fingerprints['proof:' + event.event_id] = createHash('sha256').update(JSON.stringify([event.tx_id, event.data_hash, event.channel_id])).digest('hex');
    }
    phase = 'public-qr';
    const qrs = (await db.query('SELECT lot_id,trace_token FROM trace_qr')).rows;
    assert.ok(qrs.length > 0);
    for (const qr of qrs) {
      const trace = await http('/public/trace/' + qr.trace_token);
      assert.equal(trace.lotId, qr.lot_id); assert.equal(trace.proofStatus, 'VERIFIED');
      assert.ok(trace.timeline.every(e => e.proofStatus === 'VERIFIED'));
      assert.equal(trace.quantityReconciled, true); assert.equal(trace.stateReconciled, true);
      assert.equal((await fetch(input.origin + '/trace/' + qr.trace_token)).status, 200);
    }
    const counts = {};
    for (const table of ['app_user', 'organization', 'farm', 'plot', 'product', 'production_cycle', 'harvest_event', 'lot', 'shipment', 'trace_event', 'blockchain_outbox', 'blockchain_proof'])
      counts[table] = Number((await db.query('SELECT count(*) FROM ' + table)).rows[0].count);
    state.completed = true; persist();
    console.log(JSON.stringify({ result: 'passed', counts, fingerprints, smoke: input.sha, canary: null,
      directLedgerEvents: events.length, verifiedQR: qrs.length, pendingEvents: 0, roles: 5, signedHandovers: input.stage === 'verify' ? 2 : null,
      externalPartnerAuthority: 'NotEvaluated', refreshLogout: true, storedEvidence: 'passed' }));
  }
} catch (error) {
  console.error(`Hosted production smoke failed at ${phase}; ${error instanceof assert.AssertionError ? error.message : 'inspect private state and reconcile original command keys'}`);
  process.exitCode = 1;
} finally {
  connection?.close(); await db.end().catch(() => {}); await prisma.$disconnect();
  if (input.stage !== 'enroll' || process.exitCode) {
    for (const credential of refresh) {
      const request = sessionRequest(credential);
      await http('/auth/logout', undefined, request.body, 201, undefined, { cookie: request.cookie }).catch(() => {});
    }
    if (existsSync(authFile)) unlinkSync(authFile);
  }
}
