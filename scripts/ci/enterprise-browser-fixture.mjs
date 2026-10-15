import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { BindingLedgerClient, RegistryOperator, certificateFingerprint, connectGateway } from '../../blockchain/gateway/dist/index.js';
import { activateBinding, registerBinding } from '../../apps/api/dist/modules/ledger/ledger-bindings.js';
import { mirrorCredential, onboardBindingOnLedger } from '../../apps/api/dist/modules/ledger/ledger-onboarding.js';

// Only the operator setup uses database/registry access. Registration, approval,
// chain creation and connection requests are performed by the actual Web UI.
export async function createEnterpriseBrowserFixture(env) {
  assert.equal(env.HYBRID_BROWSER_TESTS, '1');
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).pathname, '/hybrid');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const connections = [];
  const probes = new Map();
  const password = randomBytes(24).toString('base64url');
  const role = await db.role.upsert({ where: { code: 'SYSTEM_ADMIN' },
    create: { code: 'SYSTEM_ADMIN', name: 'SYSTEM_ADMIN' }, update: {} });
  const admin = await db.user.create({ data: { roleId: role.id, fullName: 'Isolated onboarding admin',
    email: `${randomUUID()}@example.test`, passwordHash: await hash(password, 12) } });
  // Public signup requires the normal seeded business roles, also in a fresh DB.
  for (const code of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'])
    await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const offset = Number(env.AGRI_FABRIC_PORT_OFFSET ?? 0);
  const identity = (org, name) => {
    const base = path.join(env.FABRIC_ROOT, org === 'org3' ? 'self' : 'net',
      'organizations/peerOrganizations', `${org}.example.com`);
    const msp = path.join(base, 'users', `${name}@${org}.example.com`, 'msp');
    return { certPath: path.join(msp, 'signcerts/cert.pem'), keyDir: path.join(msp, 'keystore'),
      tlsCertPath: path.join(base, 'peers', `peer0.${org}.example.com`, 'tls/ca.crt') };
  };
  const peer = org => ({ peerEndpoint: `127.0.0.1:${{ org1: 7051, org2: 9051, org3: 11051 }[org] + offset}`,
    peerHostAlias: `peer0.${org}.example.com`, tlsCertPath: identity(org, 'Admin').tlsCertPath });
  const client = async (channelName, org, name, endpointOrg = org) => {
    const material = identity(org, name);
    const connection = await connectGateway({ channelName, chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
      mspId: { org1: 'Org1MSP', org2: 'Org2MSP', org3: 'Org3MSP' }[org], ...peer(endpointOrg),
      identityCertPath: material.certPath, identityKeyDirectory: material.keyDir });
    connections.push(connection);
    return { reader: new BindingLedgerClient(connection.gateway, { channelName, chaincodeName: 'agritrace', contractName: 'AgriTraceContract' }),
      fingerprint: certificateFingerprint(connection.identityCertificate) };
  };
  const append = (file, key, value) => {
    const inventory = JSON.parse(readFileSync(file, 'utf8'));
    inventory[key].push(value);
    const temporary = `${file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, JSON.stringify(inventory), { mode: 0o600 });
    renameSync(temporary, file);
  };
  const reference = name => ({ certPath: identity('org1', name).certPath, keyDir: identity('org1', name).keyDir });
  return {
    db, admin: { email: admin.email }, password,
    publicPeer: {
      peerHost: '127.0.0.1', peerPort: 11051 + offset, peerServerName: 'peer0.org3.example.com',
      mspId: 'Org3MSP', tlsCaPem: readFileSync(identity('org3', 'Admin').tlsCertPath, 'utf8'),
    },
    assertPending: async id => {
      const row = await db.enterpriseEnrollment.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'PENDING_REVIEW');
      assert.equal(await db.organizationCapability.count({ where: { organizationId: row.organizationId } }), 0);
      assert.equal(await db.scopedRoleGrant.count({ where: { userId: row.ownerId, revokedAt: null } }), 0);
      return row;
    },
    provision: async (enrollmentId, chainId, connectionId) => {
      const enrollment = await db.enterpriseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      assert.equal(enrollment.status, 'APPROVED');
      const chain = await db.supplyChain.findUniqueOrThrow({ where: { id: chainId } });
      assert.equal(chain.ownerOrganizationId, enrollment.organizationId);
      const owner = enrollment.hostingMode === 'MANAGED_ORG' ? 'org2' : 'org3';
      const ownerMspId = owner === 'org2' ? 'Org2MSP' : 'Org3MSP';
      const channelId = owner === 'org2' ? 'hybrid-b' : 'hybrid-self';
      const relayer = await client(channelId, 'org1', 'relayer');
      const controller = await client(channelId, 'org1', 'controller');
      const admin1 = await client(channelId, 'org1', 'Admin');
      const adminOwner = await client(channelId, owner, 'Admin');
      const remote = await client(channelId, 'org1', 'relayer', owner);
      const operator = new RegistryOperator(controller.reader, { Org1MSP: admin1.reader, [ownerMspId]: adminOwner.reader });
      const health = await relayer.reader.health();
      const binding = await db.$transaction(tx => registerBinding(tx, { chainId, network: env.AGRI_FABRIC_INSTANCE,
        channelId, chaincodeName: 'agritrace', contractName: 'AgriTraceContract', writerAuthority: 'agritrace-relayer-b',
        writerMspId: 'Org1MSP', governanceDigest: health.governanceDigest, profile: enrollment.hostingMode }));
      await onboardBindingOnLedger({ operator, reader: relayer.reader, channelId, approvers: ['Org1MSP', ownerMspId],
        binding: { digest: binding.digest, network: env.AGRI_FABRIC_INSTANCE, chaincodeName: 'agritrace',
          contractName: 'AgriTraceContract', chainRef: binding.chainRef, writerAuthority: 'agritrace-relayer-b',
          writerMspId: 'Org1MSP', governanceDigest: health.governanceDigest }, relayerFingerprint: relayer.fingerprint });
      await db.$transaction(tx => mirrorCredential(tx, binding.digest, relayer.fingerprint));
      append(env.FABRIC_BINDINGS_CONFIG, 'bindings', { bindingDigest: binding.digest, ...peer('org1'), mspId: 'Org1MSP',
        relayer: reference('relayer'), controller: reference('controller'), admin: reference('Admin') });
      await db.$transaction(tx => activateBinding(tx, binding.digest));
      append(env.ENTERPRISE_CONNECTIONS_CONFIG, 'targets', { connectionId, organizationId: enrollment.organizationId,
        chainId, bindingDigest: binding.digest, ownerMspId, ...peer(owner) });
      probes.set(connectionId, { local: relayer.reader, remote: remote.reader, bindingDigest: binding.digest });
    },
    verifyProbe: async connectionId => {
      const row = await db.enterpriseConnection.findUniqueOrThrow({ where: { id: connectionId } });
      assert.equal(row.status, 'CONNECTED');
      assert.ok(row.checkedAt);
      assert.match(row.txId, /^[a-f0-9]{64}$/);
      const { local, remote, bindingDigest } = probes.get(connectionId);
      const localProof = await local.query('GetConnectionProbe', bindingDigest, row.challenge);
      const remoteProof = await remote.query('GetConnectionProbe', bindingDigest, row.challenge);
      assert.ok(JSON.stringify(localProof) === JSON.stringify(remoteProof), 'Both real peers must expose the same probe');
      assert.equal(localProof.txId, row.txId);
      assert.equal(localProof.organizationRef, (await db.enterpriseEnrollment.findUniqueOrThrow({ where: { id: row.enrollmentId } })).organizationId);
      assert.equal(await local.transactionValidationCode(row.txId), 0);
      assert.equal(await remote.transactionValidationCode(row.txId), 0);
      return { connectionId, bindingDigest, txId: row.txId, validationCode: 0, ownerMsp: localProof.ownerMsp };
    },
    close: async () => { for (const connection of connections) connection.close(); await db.$disconnect(); },
  };
}
