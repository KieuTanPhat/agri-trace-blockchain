import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { hash, compare } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../dist/generated/prisma/client.js';
import { connectGateway, BindingLedgerClient, RegistryOperator, certificateFingerprint } from '../../../blockchain/gateway/dist/index.js';
import { registerBinding, activateBinding } from '../dist/modules/ledger/ledger-bindings.js';
import { onboardBindingOnLedger, mirrorCredential } from '../dist/modules/ledger/ledger-onboarding.js';
import { registerSigningKeyOnLedger, activateSigningKey, setHandoverMode } from '../dist/modules/ledger/ledger-signing.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const roles = ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR'];
export function validateBootstrap(input, environment = process.env) {
  assert.equal(environment.APP_ENV, 'production');
  assert.equal(environment.PRODUCTION_BOOTSTRAP_ENABLED, 'true');
  assert.equal(input.protocol, 'agritrace-production-bootstrap/1');
  const database = new URL(input.databaseUrl);
  assert.match(database.pathname, /^\/agri_trace_prod$/);
  assert.ok(Array.isArray(input.accounts) && input.accounts.length === roles.length);
  assert.deepEqual([...new Set(input.accounts.map(a => a.role))].sort(), [...roles].sort());
  for (const account of input.accounts) {
    assert.match(account.id, UUID);
    assert.match(account.email, /^[^\s@]+@[^\s@]+$/);
    assert.ok(account.password.length >= 24 && Buffer.byteLength(account.password) <= 72);
    if (account.role !== 'SYSTEM_ADMIN') assert.match(account.organizationId, UUID);
  }
  for (const name of ['chainId', 'farmId', 'productId', 'plotId']) assert.match(input.catalog[name], UUID);
  assert.ok(input.network && input.channel && input.chaincode && input.writerAuthority);
  for (const identity of Object.values(input.connections)) {
    for (const name of ['certPath', 'keyDir', 'tlsCertPath']) {
      assert.ok(identity[name].startsWith('/operator/') && !identity[name].split('/').includes('..'));
    }
  }
  assert.ok(['provision', 'activate-keys'].includes(input.operation ?? 'provision'));
  return input;
}

export function workerBindingNode(worker, bindingDigest) {
  assert.ok(worker && typeof worker === 'object' && !Array.isArray(worker), 'Worker connection is missing');
  assert.match(bindingDigest, /^[a-f0-9]{64}$/);
  return { ...worker, bindingDigest };
}

/** False when the entry must still be added; throws when it differs. */
export function inventoryHasBinding(document, node) {
  assert.ok(document && Array.isArray(document.bindings), 'Worker binding inventory is invalid');
  const existing = document.bindings.find(b => b.bindingDigest === node.bindingDigest);
  if (!existing) return false;
  assert.deepEqual(existing, node, 'Existing Worker binding differs');
  return true;
}

const parties = [['FARM_STAFF', 'FARM'], ['TRANSPORTER', 'TRANSPORTER'], ['RETAILER', 'RETAILER'], ['AUDITOR', 'AUDITOR']];

// Database half of the `provision` operation. It is exported so a real PostgreSQL test can exercise the
// exact production transaction; bootstrapProduction() below remains its only production caller.
export async function provisionBusinessCatalog(db, input) {
  const byRole = Object.fromEntries(input.accounts.map(a => [a.role, a]));
  const catalog = input.catalog;
  await db.$transaction(async tx => {
    for (const [code, type] of parties) {
      const account = byRole[code];
      const existing = await tx.organization.findUnique({ where: { id: account.organizationId } });
      if (existing) assert.equal(existing.type, type, 'Existing bootstrap organization differs');
      else await tx.organization.create({ data: { id: account.organizationId, name: `Production smoke ${type}`, type } });
    }
    for (const account of input.accounts) {
      const role = await tx.role.upsert({ where: { code: account.role }, create: { code: account.role, name: account.role }, update: {} });
      const existing = await tx.user.findUnique({ where: { id: account.id } });
      if (existing) {
        assert.equal(existing.email, account.email);
        assert.equal(existing.roleId, role.id);
        assert.equal(existing.organizationId, account.organizationId ?? null);
        assert.ok(await compare(account.password, existing.passwordHash), 'Existing bootstrap credentials differ');
      } else await tx.user.create({ data: { id: account.id, email: account.email, fullName: `Production ${account.role}`,
        passwordHash: await hash(account.password, 12), roleId: role.id, organizationId: account.organizationId } });
      if (account.organizationId) {
        for (const scoped of ['ORG_ADMIN', ...(account.role === 'FARM_STAFF' ? ['CREATE_CHAIN'] : [])]) {
          if (!await tx.scopedRoleGrant.findFirst({ where: { userId: account.id, organizationId: account.organizationId, role: scoped, scope: 'ORGANIZATION', revokedAt: null } }))
            await tx.scopedRoleGrant.create({ data: { userId: account.id, organizationId: account.organizationId, role: scoped, scope: 'ORGANIZATION' } });
        }
      }
    }
    if (!await tx.supplyChain.findUnique({ where: { id: catalog.chainId } })) {
      await tx.supplyChain.create({ data: { id: catalog.chainId, name: 'Production technical acceptance', ownerOrganizationId: byRole.FARM_STAFF.organizationId } });
      for (const [code] of parties) await tx.chainMembership.create({ data: { chainId: catalog.chainId, organizationId: byRole[code].organizationId, status: 'ACTIVE' } });
      await tx.chainBusinessProfile.create({ data: { chainId: catalog.chainId } });
      await tx.chainBusinessProfile.update({ where: { chainId: catalog.chainId }, data: { state: 'ACTIVE', version: { increment: 1 } } });
    }
    for (const code of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR', 'CHAIN_MANAGER']) {
      const account = byRole[code === 'CHAIN_MANAGER' ? 'FARM_STAFF' : code];
      if (!await tx.scopedRoleGrant.findFirst({ where: { userId: account.id, chainId: catalog.chainId, role: code, revokedAt: null } }))
        await tx.scopedRoleGrant.create({ data: { userId: account.id, organizationId: account.organizationId, chainId: catalog.chainId, scope: 'CHAIN', role: code } });
    }
    if (!await tx.farm.findUnique({ where: { id: catalog.farmId } })) await tx.farm.create({ data: { id: catalog.farmId, name: 'Production technical farm', organizationId: byRole.FARM_STAFF.organizationId } });
    if (!await tx.product.findUnique({ where: { id: catalog.productId } })) await tx.product.create({ data: { id: catalog.productId, productName: 'Production technical product', defaultUnit: 'kg' } });
    if (!await tx.plot.findUnique({ where: { id: catalog.plotId } })) await tx.plot.create({ data: { id: catalog.plotId, farmId: catalog.farmId, name: 'Production technical plot' } });
  }, { timeout: 60_000 });
}

export async function bootstrapProduction(input) {
  validateBootstrap(input);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: input.databaseUrl }) });
  const connections = [];
  const byRole = Object.fromEntries(input.accounts.map(a => [a.role, a]));
  const catalog = input.catalog;
  try {
    if ((input.operation ?? 'provision') === 'provision') {
      await provisionBusinessCatalog(db, input);
    }
    const client = async name => {
      const ref = input.connections[name];
      const connection = await connectGateway({ channelName: input.channel, chaincodeName: input.chaincode, contractName: 'AgriTraceContract',
        mspId: ref.mspId, peerEndpoint: ref.peerEndpoint, peerHostAlias: ref.peerHostAlias, tlsCertPath: ref.tlsCertPath,
        identityCertPath: ref.certPath, identityKeyDirectory: ref.keyDir });
      connections.push(connection);
      return { reader: new BindingLedgerClient(connection.gateway, { channelName: input.channel, chaincodeName: input.chaincode, contractName: 'AgriTraceContract' }),
        fingerprint: certificateFingerprint(connection.identityCertificate) };
    };
    const relayer = await client('relayer'), control = await client('controller'), writerAdmin = await client('writerAdmin'), ownerAdmin = await client('ownerAdmin');
    const adminReaders = { [input.connections.writerAdmin.mspId]: writerAdmin.reader, [input.connections.ownerAdmin.mspId]: ownerAdmin.reader };
    const operator = new RegistryOperator(control.reader, adminReaders);
    const approvers = Object.keys(adminReaders);
    const health = await relayer.reader.health();
    assert.equal(health.governanceDigest, input.governanceDigest);
    const binding = await db.$transaction(tx => registerBinding(tx, { chainId: catalog.chainId, network: input.network, channelId: input.channel,
      chaincodeName: input.chaincode, contractName: 'AgriTraceContract', writerAuthority: input.writerAuthority,
      writerMspId: input.connections.relayer.mspId, governanceDigest: health.governanceDigest, profile: 'MANAGED_ORG' }));
    if ((input.operation ?? 'provision') === 'provision') {
      await onboardBindingOnLedger({ operator, reader: relayer.reader, channelId: input.channel, approvers,
        binding: { digest: binding.digest, network: input.network, chaincodeName: input.chaincode, contractName: 'AgriTraceContract',
          chainRef: binding.chainRef, writerAuthority: input.writerAuthority, writerMspId: input.connections.relayer.mspId, governanceDigest: health.governanceDigest },
        relayerFingerprint: relayer.fingerprint });
      await db.$transaction(tx => mirrorCredential(tx, binding.digest, relayer.fingerprint));
      const node = workerBindingNode(input.workerConnection, binding.digest);
      // The inventory is mounted read-only. The host controller adds the entry
      // with a locked atomic replace and reruns this idempotent bootstrap; the
      // binding is activated only once the Worker inventory carries it.
      if (!inventoryHasBinding(JSON.parse(readFileSync('/worker-bindings.json', 'utf8')), node))
        return { result: 'inventory-required', bindingDigest: binding.digest, workerBinding: node };
      await db.$transaction(tx => activateBinding(tx, binding.digest));
    } else {
      for (const keyRef of input.keyRefs) {
        const key = await db.signingKey.findUniqueOrThrow({ where: { keyRef } });
        assert.equal(key.bindingDigest, binding.digest);
        assert.ok(parties.some(([code]) => byRole[code].organizationId === key.organizationId));
        if (key.status !== 'ACTIVE') {
          await registerSigningKeyOnLedger({ operator, reader: relayer.reader, approvers, key });
          await activateSigningKey(db, keyRef);
        }
      }
      const profile = await db.chainLedgerProfile.findUniqueOrThrow({ where: { chainId: catalog.chainId } });
      if (profile.handoverMode !== 'DUAL_SIGNED') await setHandoverMode(db, catalog.chainId, 'DUAL_SIGNED');
    }
    return { result: 'passed', chainId: catalog.chainId, bindingDigest: binding.digest, chainRef: binding.chainRef };
  } finally {
    for (const connection of connections) connection.close();
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (Buffer.concat(chunks).length > 64 * 1024) throw Error('Bootstrap input too large');
  bootstrapProduction(JSON.parse(Buffer.concat(chunks).toString())).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Production bootstrap failed; no credential was printed and existing state was preserved'); process.exitCode = 1;
  });
}
