import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { provisionBusinessCatalog, validateBootstrap } from '../../apps/api/scripts/bootstrap-production.mjs';

const connectionString = process.env.BOOTSTRAP_TEST_DATABASE_URL;
if (!connectionString || !/(_ci|_test|checks)/.test(new URL(connectionString).pathname)) {
  throw new Error('BOOTSTRAP_TEST_DATABASE_URL must identify a dedicated test database');
}
const database = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const PARTIES = { FARM_STAFF: 'FARM', TRANSPORTER: 'TRANSPORTER', RETAILER: 'RETAILER', AUDITOR: 'AUDITOR' };

function bootstrapInput() {
  const organizations = Object.fromEntries(Object.keys(PARTIES).map(role => [role, randomUUID()]));
  return {
    protocol: 'agritrace-production-bootstrap/1',
    databaseUrl: 'postgresql://agritrace:secret@postgres:5432/agri_trace_prod?schema=public',
    accounts: ['SYSTEM_ADMIN', ...Object.keys(PARTIES)].map(role => ({
      id: randomUUID(), role, email: `${role.toLowerCase()}-${randomUUID()}@bootstrap.example.test`,
      password: randomBytes(24).toString('base64url'), ...(role === 'SYSTEM_ADMIN' ? {} : { organizationId: organizations[role] }),
    })),
    catalog: { chainId: randomUUID(), farmId: randomUUID(), productId: randomUUID(), plotId: randomUUID() },
    network: 'hosted', channel: 'hybrid-b', chaincode: 'agritrace', writerAuthority: 'operator',
    connections: { relayer: { certPath: '/operator/relayer/cert.pem', keyDir: '/operator/relayer/keys', tlsCertPath: '/operator/tls.pem' } },
    operation: 'provision',
  };
}
const production = { APP_ENV: 'production', PRODUCTION_BOOTSTRAP_ENABLED: 'true' };
const accountOf = (input, role) => input.accounts.find(account => account.role === role);
const emails = input => input.accounts.map(account => account.email);

test('bootstrap input is refused outside an explicitly enabled production context and for unsafe values', () => {
  const input = bootstrapInput();
  assert.equal(validateBootstrap(input, production), input);
  assert.throws(() => validateBootstrap(input, { ...production, APP_ENV: 'uat' }));
  assert.throws(() => validateBootstrap(input, { ...production, PRODUCTION_BOOTSTRAP_ENABLED: 'false' }));
  assert.throws(() => validateBootstrap({ ...input, databaseUrl: input.databaseUrl.replace('agri_trace_prod', 'agri_trace_uat') }, production));
  assert.throws(() => validateBootstrap({ ...input, protocol: 'other/1' }, production));
  assert.throws(() => validateBootstrap({ ...input, operation: 'reset' }, production));
  const weak = bootstrapInput();
  weak.accounts[1].password = 'short';
  assert.throws(() => validateBootstrap(weak, production));
  const duplicate = bootstrapInput();
  duplicate.accounts[4].role = 'RETAILER';
  assert.throws(() => validateBootstrap(duplicate, production));
  const escaping = bootstrapInput();
  escaping.connections.relayer.keyDir = '/operator/../etc';
  assert.throws(() => validateBootstrap(escaping, production));
});

test('provisioning creates hashed accounts, organizations with capabilities, one ACTIVE chain and scoped grants', async () => {
  const input = bootstrapInput();
  await provisionBusinessCatalog(database, input);
  const users = await database.user.findMany({ where: { email: { in: emails(input) } }, include: { role: true } });
  assert.equal(users.length, 5);
  for (const user of users) {
    assert.ok(user.passwordHash.startsWith('$2b$12$'));
    assert.equal(user.role.code, input.accounts.find(account => account.id === user.id).role);
  }
  assert.equal(users.find(user => user.role.code === 'SYSTEM_ADMIN').organizationId, null);
  for (const [role, type] of Object.entries(PARTIES)) {
    const organizationId = accountOf(input, role).organizationId;
    assert.equal((await database.organization.findUnique({ where: { id: organizationId } })).type, type);
    // The database, not this script, grants each organization the capability matching its type.
    const capability = await database.organizationCapability.findUnique({ where: { organizationId_code: { organizationId, code: type } } });
    assert.ok(capability && !capability.revokedAt, `${type} capability`);
  }
  const chain = await database.supplyChain.findUnique({ where: { id: input.catalog.chainId }, include: { memberships: true, businessProfile: true } });
  assert.equal(chain.ownerOrganizationId, accountOf(input, 'FARM_STAFF').organizationId);
  assert.equal(chain.businessProfile.state, 'ACTIVE');
  assert.deepEqual(chain.memberships.map(item => item.organizationId).sort(), Object.keys(PARTIES).map(role => accountOf(input, role).organizationId).sort());
  assert.ok(chain.memberships.every(item => item.status === 'ACTIVE'));
  const grants = async (role, filter) => (await database.scopedRoleGrant.findMany({
    where: { userId: accountOf(input, role).id, revokedAt: null, ...filter },
  })).map(grant => grant.role).sort();
  const inChain = { chainId: input.catalog.chainId };
  assert.deepEqual(await grants('FARM_STAFF', inChain), ['CHAIN_MANAGER', 'FARM_STAFF']);
  assert.deepEqual(await grants('TRANSPORTER', inChain), ['TRANSPORTER']);
  assert.deepEqual(await grants('RETAILER', inChain), ['RETAILER']);
  assert.deepEqual(await grants('AUDITOR', inChain), ['AUDITOR']);
  assert.deepEqual(await grants('SYSTEM_ADMIN', {}), [], 'The administrator must not receive business grants');
  assert.deepEqual(await grants('FARM_STAFF', { scope: 'ORGANIZATION' }), ['CREATE_CHAIN', 'ORG_ADMIN']);
  for (const role of ['TRANSPORTER', 'RETAILER', 'AUDITOR']) assert.deepEqual(await grants(role, { scope: 'ORGANIZATION' }), ['ORG_ADMIN']);
  assert.ok(await database.farm.findUnique({ where: { id: input.catalog.farmId } }));
  assert.ok(await database.plot.findUnique({ where: { id: input.catalog.plotId } }));
  assert.equal((await database.product.findUnique({ where: { id: input.catalog.productId } })).defaultUnit, 'kg');
});

test('replaying the same input changes nothing, including password hashes and grant counts', async () => {
  const input = bootstrapInput();
  await provisionBusinessCatalog(database, input);
  const snapshot = async () => ({
    hashes: (await database.user.findMany({ where: { email: { in: emails(input) } }, orderBy: { id: 'asc' } })).map(user => `${user.id}:${user.passwordHash}`),
    grants: await database.scopedRoleGrant.count({ where: { user: { email: { in: emails(input) } } } }),
    memberships: await database.chainMembership.count({ where: { chainId: input.catalog.chainId } }),
    organizations: await database.organization.count({ where: { id: { in: Object.keys(PARTIES).map(role => accountOf(input, role).organizationId) } } }),
  });
  const first = await snapshot();
  await provisionBusinessCatalog(database, input);
  assert.deepEqual(await snapshot(), first);
  assert.equal(first.grants, 10, 'Four organization admins, one chain creator and five chain grants');
});

test('a changed credential on replay is rejected and never overwrites the stored account', async () => {
  const input = bootstrapInput();
  await provisionBusinessCatalog(database, input);
  const before = (await database.user.findUnique({ where: { id: accountOf(input, 'RETAILER').id } })).passwordHash;
  const changed = structuredClone(input);
  accountOf(changed, 'RETAILER').password = randomBytes(24).toString('base64url');
  await assert.rejects(provisionBusinessCatalog(database, changed), /Existing bootstrap credentials differ/);
  assert.equal((await database.user.findUnique({ where: { id: accountOf(input, 'RETAILER').id } })).passwordHash, before);
});

test('a conflict late in the transaction rolls back every earlier organization and account', async () => {
  const input = bootstrapInput();
  const blocker = accountOf(input, 'RETAILER');
  const role = await database.role.upsert({ where: { code: 'RETAILER' }, create: { code: 'RETAILER', name: 'RETAILER' }, update: {} });
  // Same identifier, different email: the fourth account fails after organizations and three accounts were written.
  await database.user.create({ data: { id: blocker.id, email: `other-${randomUUID()}@bootstrap.example.test`, fullName: 'Existing user',
    passwordHash: await hash(randomBytes(16).toString('hex'), 4), roleId: role.id } });
  try {
    await assert.rejects(provisionBusinessCatalog(database, input));
    assert.equal(await database.user.count({ where: { email: { in: emails(input) } } }), 0);
    assert.equal(await database.organization.count({ where: { id: { in: Object.keys(PARTIES).map(party => accountOf(input, party).organizationId) } } }), 0);
    assert.equal(await database.supplyChain.count({ where: { id: input.catalog.chainId } }), 0);
  } finally {
    await database.user.delete({ where: { id: blocker.id } });
  }
});

test.after(async () => { await database.$disconnect(); });
