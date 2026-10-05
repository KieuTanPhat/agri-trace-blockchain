import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { FabricBlockchainAdapter, connectGateway, loadConfig } from '../../blockchain/gateway/dist/index.js';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const composeArgs = ['compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.ci.yml'];
const apiUrl = process.env.CI_API_URL ?? 'http://localhost:8080/api';
const evidence = {
  sha: process.env.GITHUB_SHA ?? null,
  startedAt: new Date().toISOString(),
  network: 'hyperledger-fabric',
  channel: process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
  chaincode: process.env.FABRIC_CHAINCODE_NAME ?? 'agritrace',
  steps: [],
  events: [],
  result: 'failed',
};

function compose(args, input, quiet = false) {
  const result = spawnSync('docker', [...composeArgs, ...args], {
    cwd: repository,
    input,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
    env: process.env,
  });
  // Never print fixture code, passwords, JWTs or signing material on failure.
  if (result.error || result.status !== 0) {
    if (!quiet && result.stderr) console.error(result.stderr);
    throw new Error(`Compose ${args[0]} failed (status ${result.status ?? 'unavailable'})`);
  }
  return result.stdout.trim();
}

function inApi(source) {
  return JSON.parse(compose(['exec', '-T', 'api', 'node', '--input-type=module'], source, true));
}

function database(source) {
  return inApi(`
    import { PrismaPg } from '@prisma/adapter-pg';
    import { PrismaClient } from './apps/api/dist/generated/prisma/client.js';
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
    try { ${source} } finally { await db.$disconnect(); }
  `);
}

async function http(route, token, body, key, status = body === undefined ? 200 : 201) {
  const response = await fetch(`${apiUrl}${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, status, `${route}: unexpected HTTP status`);
  const envelope = await response.json();
  assert.ok(envelope.data, `${route}: missing response data`);
  return envelope.data;
}

function checkpoint(step) {
  evidence.steps.push(step);
  console.log(step);
}

async function main() {
  // Use a fresh Compose project and database. Trace history is append-only;
  // cleanup is the workflow's volume removal, never deletion of event rows.
  const password = randomBytes(24).toString('base64url');
  const email = `ci-fabric-${randomUUID()}@example.test`;
  const fixture = database(`
    const { hash } = await import('bcrypt');
    const role = await db.role.upsert({ where: { code: 'FARM_STAFF' }, create: { code: 'FARM_STAFF', name: 'CI farmer' }, update: {} });
    const org = await db.organization.create({ data: { name: 'CI Fabric farm', type: 'FARM' } });
    const farm = await db.farm.create({ data: { name: 'CI Fabric farm', organizationId: org.id } });
    const product = await db.product.create({ data: { productName: 'CI Fabric vegetables', defaultUnit: 'kg' } });
    await db.user.create({ data: { email: ${JSON.stringify(email)}, passwordHash: await hash(${JSON.stringify(password)}, 10), fullName: 'CI farmer', roleId: role.id, organizationId: org.id } });
    console.log(JSON.stringify({ farmId: farm.id, productId: product.id }));
  `);
  const auth = await http('/auth/login', undefined, { email, password });
  assert.ok(auth.accessToken, 'Login must issue an access token');
  const token = auth.accessToken;
  checkpoint('Production API authenticated a scoped farmer');

  const key = randomUUID();
  const createBody = {
    farmId: fixture.farmId,
    productId: fixture.productId,
    cycleCode: `CI-${randomUUID()}`,
    maxHarvestQuantity: 3,
    harvestUnit: 'kg',
  };
  const cycle = await http('/production-cycles', token, createBody, key);
  const replay = await http('/production-cycles', token, createBody, key);
  assert.equal(replay.id, cycle.id, 'Idempotency replay must preserve cycle id');
  await http(`/production-cycles/${cycle.id}/plant`, token, {
    version: 0,
    plantedAt: new Date(Date.now() - 60_000).toISOString(),
  }, randomUUID());
  await http(`/production-cycles/${cycle.id}/care`, token, {
    version: 1,
    careType: 'WATERING',
    eventTime: new Date().toISOString(),
  }, randomUUID());
  const harvest = await http(`/production-cycles/${cycle.id}/harvests`, token, {
    quantity: 3,
    unit: 'kg',
    harvestTime: new Date().toISOString(),
  }, randomUUID());
  assert.ok(harvest.lot?.id && harvest.traceQr?.traceToken, 'Harvest must create a lot and QR');
  const traceRoute = `/public/trace/${harvest.traceQr.traceToken}`;
  const readEvents = () => database(`
    const events = await db.traceEvent.findMany({
      where: { cycleId: ${JSON.stringify(cycle.id)} },
      select: { id: true, entityType: true, entityId: true, eventType: true, dataHash: true, previousEventHash: true,
        blockchainOutbox: { select: { status: true, attemptCount: true } },
        blockchainProof: { select: { transactionStatus: true, txId: true, dataHash: true, channelId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    console.log(JSON.stringify(events));
  `);
  const pending = readEvents();
  assert.equal(pending.length, 4, 'Create, plant, care and harvest must each append one event');
  assert.equal(pending.filter(event => event.eventType === 'PRODUCTION_CYCLE_CREATED').length, 1);
  for (const event of pending) {
    assert.equal(event.blockchainOutbox?.status, 'PENDING');
    assert.equal(event.blockchainProof, null);
    const proof = await http(`/blockchain/events/${event.id}/verify`, token);
    assert.equal(proof.status, 'PENDING');
    assert.equal(proof.txId, null);
    assert.equal(proof.localHashMatches, true);
  }
  const pendingTrace = await http(traceRoute);
  assert.equal(pendingTrace.proofStatus, 'PENDING');
  assert.equal(pendingTrace.lotId, harvest.lot.id);
  checkpoint('Commands committed domain data and one outbox row per event while Worker was stopped; QR is PENDING');

  compose(['up', '-d', '--wait', '--wait-timeout', '180', 'worker']);
  let confirmed;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const events = readEvents();
    assert.equal(events.length, pending.length, 'Worker must not create or lose business events');
    assert.ok(events.every(event => event.blockchainOutbox?.status !== 'DEAD_LETTER'), 'Worker dead-lettered an integration event');
    if (events.every(event => event.blockchainOutbox?.status === 'COMPLETED' && event.blockchainProof?.transactionStatus === 'CONFIRMED')) {
      confirmed = events;
      break;
    }
    await delay(1000);
  }
  assert.ok(confirmed, 'Timed out waiting for Worker to drain the outbox and persist confirmed proofs');
  checkpoint('Dedicated production Worker drained the outbox and persisted CONFIRMED proofs');

  const config = loadConfig({
    ...process.env,
    FABRIC_SAMPLES_DIR: path.join(repository, 'blockchain/.fabric/fabric-samples'),
    RELAYER_MSP_DIR: path.join(repository, 'blockchain/network/identities/relayer/msp'),
    FABRIC_PEER_ENDPOINT: process.env.CI_LEDGER_PEER_ENDPOINT ?? 'localhost:7051',
  });
  const connection = await connectGateway(config);
  try {
    const adapter = new FabricBlockchainAdapter(connection.gateway, config);
    for (const event of confirmed) {
      const [ledgerEvent, ledgerProof, expectedHash, apiProof] = await Promise.all([
        adapter.queryEvent(event.id),
        adapter.getProof(event.id),
        adapter.getExpectedHash(event.id),
        http(`/blockchain/events/${event.id}/verify`, token),
      ]);
      assert.equal(expectedHash, event.dataHash);
      assert.equal(ledgerEvent.dataHash, event.dataHash);
      assert.equal(ledgerProof.dataHash, event.dataHash);
      assert.ok(ledgerProof.txId, 'Ledger proof must include a committed transaction id');
      assert.equal(ledgerProof.txId, event.blockchainProof.txId);
      assert.equal(apiProof.txId, ledgerProof.txId);
      assert.equal(apiProof.status, 'CONFIRMED');
      assert.equal(apiProof.deliveryStatus, 'COMPLETED');
      assert.equal(apiProof.localHashMatches, true);
      assert.equal(apiProof.dataHash, event.dataHash);
      assert.equal(event.blockchainProof.channelId, config.channelName);
      evidence.events.push({ eventId: event.id, eventType: event.eventType, dataHash: event.dataHash, txId: ledgerProof.txId });
    }
    const chain = confirmed.filter(event => event.entityType === 'PRODUCTION_CYCLE' && event.entityId === cycle.id);
    assert.ok(chain.length >= 2, 'Integration must exercise ordered events');
    assert.ok(chain.some(event => event.previousEventHash), 'A predecessor hash must be delivered');
    const head = await adapter.getEntityHead('PRODUCTION_CYCLE', cycle.id);
    const history = await adapter.queryEntityHistory('PRODUCTION_CYCLE', cycle.id);
    assert.equal(history.length, chain.length);
    assert.equal(head.eventCount, chain.length);
    assert.ok(chain.some(event => event.id === head.lastEventId && event.dataHash === head.lastDataHash));
  } finally {
    connection.close();
  }
  const verifiedTrace = await http(traceRoute);
  assert.equal(verifiedTrace.proofStatus, 'VERIFIED');
  assert.ok(verifiedTrace.timeline.length >= 4);
  assert.ok(verifiedTrace.timeline.every(event => event.proofStatus === 'VERIFIED'));
  checkpoint('Direct Fabric query matches every database/API proof; the full QR timeline is VERIFIED');

  const health = JSON.parse(compose(['exec', '-T', 'worker', 'node', '--input-type=module'], `
    const response = await fetch('http://127.0.0.1:8081/health/ready');
    if (!response.ok) throw new Error('Worker is not ready');
    console.log(JSON.stringify(await response.json()));
  `, true));
  assert.equal(health.runtime.enabled, true);
  assert.equal(health.runtime.running, true);
  assert.ok(health.runtime.lastCompletedAt);
  assert.equal(health.runtime.lastError, null);
  assert.deepEqual(health.backlog, { pending: 0, retry: 0, deadLetter: 0 });
  checkpoint('Worker is ready, its loop is active, and backlog is empty');
}

try {
  await main();
  evidence.result = 'passed';
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Fabric integration failed');
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(path.join(repository, 'artifacts'), { recursive: true });
  writeFileSync(path.join(repository, 'artifacts/fabric-integration.json'), JSON.stringify(evidence, null, 2) + '\n');
}
