import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { hash } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { connectGateway, BindingLedgerClient, RegistryOperator, certificateFingerprint } from '../../blockchain/gateway/dist/index.js';
import { registerBinding, activateBinding } from '../../apps/api/dist/modules/ledger/ledger-bindings.js';
import { onboardBindingOnLedger, mirrorCredential } from '../../apps/api/dist/modules/ledger/ledger-onboarding.js';
import { activateSigningKey, registerSigningKeyOnLedger, setHandoverMode as changeMode } from '../../apps/api/dist/modules/ledger/ledger-signing.js';

export async function createBrowserFixture(env, origin, label = 'browser', { waitForWorker = true } = {}) {
  const database = new URL(env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.pathname, '/hybrid');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const jwt = new JwtService({ secret: env.JWT_SECRET });
  const password = randomBytes(24).toString('base64url');
  const sessions = {};
  const connections = [];
  const users = {};
  for (const [party, code, type] of [['farm', 'FARM_STAFF', 'FARM'], ['transporter', 'TRANSPORTER', 'TRANSPORTER'], ['retailer', 'RETAILER', 'RETAILER'], ['other', 'FARM_STAFF', 'FARM']]) {
    const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
    const org = await db.organization.create({ data: { name: `${label} ${party}`, type } });
    const user = await db.user.create({ data: { email: `${randomUUID()}@example.test`, fullName: `${label} ${party}`, passwordHash: await hash(password, 10), roleId: role.id, organizationId: org.id } });
    users[party] = { id: user.id, email: user.email, organizationId: org.id };
    sessions[party] = randomUUID();
    await db.refreshSession.create({ data: { id: sessions[party], familyId: sessions[party], userId: user.id,
      tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 3_600_000) } });
    for (const scoped of ['ORG_ADMIN', ...(type === 'FARM' ? ['CREATE_CHAIN'] : [])])
      await db.scopedRoleGrant.create({ data: { userId: user.id, organizationId: org.id, scope: 'ORGANIZATION', role: scoped } });
  }
  const farm = await db.farm.create({ data: { name: label, organizationId: users.farm.organizationId } });
  const product = await db.product.create({ data: { productName: label, defaultUnit: 'kg' } });
  // The owner membership constraint is deferred to commit: create the chain atomically.
  const chain = await db.$transaction(async tx => {
    const created = await tx.supplyChain.create({ data: { name: `${label} ${randomUUID()}`, ownerOrganizationId: users.farm.organizationId } });
    for (const party of ['farm', 'transporter', 'retailer'])
      await tx.chainMembership.create({ data: { chainId: created.id, organizationId: users[party].organizationId, status: 'ACTIVE' } });
    await tx.chainBusinessProfile.create({ data: { chainId: created.id } });
    await tx.chainBusinessProfile.update({ where: { chainId: created.id }, data: { state: 'ACTIVE', version: { increment: 1 } } });
    return created;
  });
  for (const [party, role] of [['farm', 'FARM_STAFF'], ['farm', 'CHAIN_MANAGER'], ['transporter', 'TRANSPORTER'], ['retailer', 'RETAILER']])
    await db.scopedRoleGrant.create({ data: { userId: users[party].id, organizationId: users[party].organizationId, chainId: chain.id, scope: 'CHAIN', role } });
  // Same-organization handover still requires each business capability/role.
  // Ownership/ORG_ADMIN alone never supplies a transport or retail permission.
  for (const code of ['TRANSPORTER', 'RETAILER']) {
    await db.organizationCapability.create({ data: { organizationId: users.farm.organizationId, code } });
    await db.scopedRoleGrant.create({ data: { userId: users.farm.id, organizationId: users.farm.organizationId, chainId: chain.id, scope: 'CHAIN', role: code } });
  }
  const root = env.FABRIC_ROOT;
  const offset = Number(env.AGRI_FABRIC_PORT_OFFSET ?? 0);
  const identity = (org, name) => {
    const base = path.join(root, 'net/organizations/peerOrganizations', `${org}.example.com`);
    const msp = path.join(base, 'users', `${name}@${org}.example.com`, 'msp');
    return { certPath: path.join(msp, 'signcerts/cert.pem'), keyDir: path.join(msp, 'keystore'),
      tlsCertPath: path.join(base, 'peers', `peer0.${org}.example.com`, 'tls/ca.crt') };
  };
  const client = async (org, name) => {
    const material = identity(org, name);
    const connection = await connectGateway({ channelName: 'hybrid-b', chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
      mspId: org === 'org1' ? 'Org1MSP' : 'Org2MSP', peerEndpoint: `127.0.0.1:${(org === 'org1' ? 7051 : 9051) + offset}`,
      peerHostAlias: `peer0.${org}.example.com`, tlsCertPath: material.tlsCertPath, identityCertPath: material.certPath, identityKeyDirectory: material.keyDir });
    connections.push(connection);
    return { reader: new BindingLedgerClient(connection.gateway, { channelName: 'hybrid-b', chaincodeName: 'agritrace', contractName: 'AgriTraceContract' }),
      fingerprint: certificateFingerprint(connection.identityCertificate) };
  };
  const relayer = await client('org1', 'relayer');
  const controller = await client('org1', 'controller');
  const admin1 = await client('org1', 'Admin');
  const admin2 = await client('org2', 'Admin');
  const operator = new RegistryOperator(controller.reader, { Org1MSP: admin1.reader, Org2MSP: admin2.reader });
  const approvers = ['Org1MSP', 'Org2MSP'];
  const health = await relayer.reader.health();
  const binding = await db.$transaction(tx => registerBinding(tx, { chainId: chain.id, network: env.AGRI_FABRIC_INSTANCE,
    channelId: 'hybrid-b', chaincodeName: 'agritrace', contractName: 'AgriTraceContract', writerAuthority: 'agritrace-relayer-b',
    writerMspId: 'Org1MSP', governanceDigest: health.governanceDigest, profile: 'MANAGED_ORG' }));
  await onboardBindingOnLedger({ operator, reader: relayer.reader, channelId: 'hybrid-b', approvers,
    binding: { digest: binding.digest, network: env.AGRI_FABRIC_INSTANCE, chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
      chainRef: binding.chainRef, writerAuthority: 'agritrace-relayer-b', writerMspId: 'Org1MSP', governanceDigest: health.governanceDigest },
    relayerFingerprint: relayer.fingerprint });
  await db.$transaction(tx => mirrorCredential(tx, binding.digest, relayer.fingerprint));
  const config = JSON.parse(readFileSync(env.FABRIC_BINDINGS_CONFIG, 'utf8'));
  const reference = name => ({ certPath: identity('org1', name).certPath, keyDir: identity('org1', name).keyDir });
  config.bindings.push({ bindingDigest: binding.digest, peerEndpoint: `127.0.0.1:${7051 + offset}`, peerHostAlias: 'peer0.org1.example.com',
    tlsCertPath: identity('org1', 'relayer').tlsCertPath, mspId: 'Org1MSP',
    relayer: reference('relayer'), controller: reference('controller'), admin: reference('Admin') });
  writeFileSync(env.FABRIC_BINDINGS_CONFIG, JSON.stringify(config), { mode: 0o600 });
  await db.$transaction(tx => activateBinding(tx, binding.digest));
  const fixture = { chainId: chain.id, chainName: chain.name, bindingDigest: binding.digest, chainRef: binding.chainRef,
    farmId: farm.id, productId: product.id, users, password };
  const wait = async predicate => {
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) { if (await predicate()) return; await delay(500); }
    throw new Error('Real browser Worker did not settle');
  };
  const waitForAuthority = () => wait(async () => (await db.ledgerPermissionSync.count({ where: { permission: { binding: { digest: binding.digest } }, state: { not: 'ACTIVE' } } })) === 0);
  if (waitForWorker) await waitForAuthority();
  const command = async (party, route, body) => {
    const response = await fetch(`${origin}/api${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(),
      Authorization: `Bearer ${jwt.sign({ sub: users[party].id, sid: sessions[party] })}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    if (response.status !== 201) {
      // Only the API error code and message (no request body, token or credential) explain a rejection.
      const error = (await response.json().catch(() => ({}))).error ?? {};
      assert.fail(`Fixture business command rejected at ${route}: ${response.status} ${error.code ?? ''} ${error.message ?? ''}`);
    }
    return (await response.json()).data;
  };
  async function createPlan({ sameOrg = false } = {}) {
    const cycle = await command('farm', '/production-cycles', { chainId: chain.id, farmId: farm.id, productId: product.id,
      cycleCode: `Browser-${randomUUID()}`, maxHarvestQuantity: 2, harvestUnit: 'kg' });
    await command('farm', `/production-cycles/${cycle.id}/plant`, { version: 0, plantedAt: new Date(Date.now() - 60_000).toISOString() });
    const harvested = await command('farm', `/production-cycles/${cycle.id}/harvests`, { quantity: 2, unit: 'kg', harvestTime: new Date().toISOString() });
    const plan = await command('farm', `/supply-chains/${chain.id}/shipment-plans`, { lotId: harvested.lot.id,
      transporterOrgId: sameOrg ? users.farm.organizationId : users.transporter.organizationId,
      retailerOrgId: sameOrg ? users.farm.organizationId : users.retailer.organizationId,
      quantity: '2.000', unit: 'kg', origin: 'Fixture farm', destination: 'Fixture shop' });
    return { planId: plan.id, lotId: harvested.lot.id, plan };
  }
  async function createShipment({ sameOrg = false } = {}) {
    const { planId, lotId, plan } = await createPlan({ sameOrg });
    for (const [party, actor] of [['PRODUCER', 'farm'], ['TRANSPORTER', 'transporter'], ['RETAILER', 'retailer']])
      await command(sameOrg ? 'farm' : actor, `/supply-chains/${chain.id}/shipment-plans/${planId}/accept`, { party, revision: plan.currentRevision, payloadDigest: plan.current.payloadDigest });
    const finalized = await command('farm', `/supply-chains/${chain.id}/shipment-plans/${planId}/finalize`, { version: plan.version });
    return { shipmentId: finalized.shipmentId, lotId };
  }
  return { fixture, db, createPlan, createShipment, waitForAuthority,
    revokeGrant: async (actor, role) => {
      const party = typeof actor === 'string' ? actor : Object.keys(users).find(key => users[key].id === actor.id);
      assert.ok(party && users[party]);
      const grant = await db.scopedRoleGrant.findFirstOrThrow({ where: { userId: users[party].id, chainId: chain.id, role, revokedAt: null } });
      return command(party, `/organizations/${users[party].organizationId}/scoped-grants/${grant.id}/revoke`, { version: grant.revision, chainId: chain.id });
    },
    restoreGrant: async (actor, role) => {
      const party = typeof actor === 'string' ? actor : Object.keys(users).find(key => users[key].id === actor.id);
      assert.ok(party && users[party]);
      // DB revocation denies commands immediately; the normal ledger revoke
      // drains the old epoch asynchronously. A new grant must wait for that
      // epoch to be revoked, rather than race the real Worker with a new key.
      const permission = await db.ledgerPermission.findUniqueOrThrow({
        where: { bindingDigest_userId_role: { bindingDigest: binding.digest, userId: users[party].id, role } },
      });
      await wait(async () => (await db.ledgerPermissionSync.findUniqueOrThrow({
        where: { permissionRef: permission.permissionRef },
      })).state === 'REVOKED');
      const result = await command(party, `/organizations/${users[party].organizationId}/scoped-grants`,
        { userId: users[party].id, chainId: chain.id, role });
      await wait(async () => (await db.ledgerPermissionSync.count({ where: { permission: { binding: { digest: binding.digest } }, state: { not: 'ACTIVE' } } })) === 0);
      return result;
    },
    activateKey: async keyRef => {
      const key = await db.signingKey.findUniqueOrThrow({ where: { keyRef } });
      await registerSigningKeyOnLedger({ operator, reader: relayer.reader, approvers, key });
      return activateSigningKey(db, keyRef);
    },
    setHandoverMode: mode => changeMode(db, chain.id, mode),
    waitForProofs: () => wait(async () => (await db.blockchainOutbox.count({ where: { status: { not: 'COMPLETED' }, traceEvent: { chainContext: { chainId: chain.id } } } })) === 0),
    close: async () => { for (const connection of connections) connection.close(); await db.$disconnect(); } };
}
