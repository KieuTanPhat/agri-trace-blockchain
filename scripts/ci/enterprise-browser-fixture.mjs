import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { hash } from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/dist/generated/prisma/client.js';
import { BindingLedgerClient, connectGateway } from '../../blockchain/gateway/dist/index.js';
import { decryptOtp } from '../../apps/api/dist/modules/enterprise-onboarding/registration-otp.service.js';

// Only isolated fixture accounts and read-side acceptance. The real Worker provisions chains.
export async function createEnterpriseBrowserFixture(env) {
  assert.equal(env.HYBRID_BROWSER_TESTS, '1');
  assert.equal(new URL(env.DATABASE_URL).hostname, '127.0.0.1');
  assert.equal(new URL(env.DATABASE_URL).pathname, '/hybrid');
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
  const connections = [];
  const password = 'E2e-2026-' + randomBytes(24).toString('base64url');
  const role = await db.role.upsert({ where: { code: 'SYSTEM_ADMIN' }, create: { code: 'SYSTEM_ADMIN', name: 'SYSTEM_ADMIN' }, update: {} });
  const admin = await db.user.create({ data: { roleId: role.id, fullName: 'Isolated onboarding admin', email: `${randomUUID()}@example.test`, passwordHash: await hash(password, 12) } });
  for (const code of ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'])
    await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const secretMail = async where => {
    const mail = await db.enterpriseMail.findFirstOrThrow({ where });
    assert.ok(mail.otpCiphertext, 'Isolated mail must contain sealed credentials');
    return decryptOtp(mail.otpCiphertext, env.JWT_SECRET);
  };
  return {
    db, admin: { email: admin.email }, password,
    readOtp: verificationId => secretMail({ verificationId }),
    readTemporaryPassword: enrollmentId => secretMail({ enrollmentId, kind: 'CREDENTIALS' }),
    assertPending: async id => {
      const row = await db.enterpriseEnrollment.findUniqueOrThrow({ where: { id } });
      assert.equal(row.status, 'PENDING_REVIEW');
      assert.equal(await db.organizationCapability.count({ where: { organizationId: row.organizationId } }), 0);
      assert.equal(await db.scopedRoleGrant.count({ where: { userId: row.ownerId, revokedAt: null } }), 0);
      return row;
    },
    verifyProvisioning: async (enrollmentId, chainId) => {
      const enrollment = await db.enterpriseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } });
      const chain = await db.supplyChain.findUniqueOrThrow({ where: { id: chainId }, include: { ledgerProfile: { include: { activeBinding: { include: { state: true } } } } } });
      assert.equal(enrollment.status, 'APPROVED');
      assert.equal(chain.ownerOrganizationId, enrollment.organizationId);
      const job = await db.ledgerProvisioningJob.findUniqueOrThrow({ where: { chainId } });
      assert.equal(job.status, 'COMPLETED');
      const binding = chain.ledgerProfile.activeBinding;
      assert.equal(binding.digest, job.bindingDigest);
      assert.equal(binding.channelId, 'agritrace'); assert.equal(binding.profile, 'SERVICE');
      assert.equal(binding.writerMspId, 'AgritraceMSP'); assert.equal(binding.state.status, 'ACTIVE');
      const peer = path.join(env.FABRIC_ROOT, 'net/organizations/peerOrganizations/org1.example.com');
      const material = path.join(peer, 'users/controller@org1.example.com/msp');
      const connection = await connectGateway({ channelName: 'agritrace', chaincodeName: 'agritrace', contractName: 'AgriTraceContract',
        mspId: 'AgritraceMSP', peerEndpoint: `127.0.0.1:${7051 + Number(env.AGRI_FABRIC_PORT_OFFSET ?? 0)}`, peerHostAlias: 'peer0.org1.example.com',
        tlsCertPath: path.join(peer, 'peers/peer0.org1.example.com/tls/ca.crt'), identityCertPath: path.join(material, 'signcerts/cert.pem'), identityKeyDirectory: path.join(material, 'keystore') });
      connections.push(connection);
      const client = new BindingLedgerClient(connection.gateway, { channelName: 'agritrace', chaincodeName: 'agritrace', contractName: 'AgriTraceContract' });
      const registered = await client.getRegistryBinding(binding.digest);
      assert.equal(registered.chainRef, binding.chainRef); assert.equal(registered.status, 'ACTIVE');
      return { chainId, bindingDigest: binding.digest, channelId: binding.channelId, writerMspId: binding.writerMspId, registryConfirmed: true };
    },
    close: async () => { for (const connection of connections) connection.close(); await db.$disconnect(); },
  };
}
