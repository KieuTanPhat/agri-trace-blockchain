import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { randomUUID, X509Certificate } from 'node:crypto';
import { isUUID } from 'class-validator';
import {
  BindingLedgerClient,
  connectGateway,
} from '@agri-trace/fabric-gateway';
import {
  Prisma,
  type EnterpriseConnection,
} from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BindingConnectionPool } from '../ledger/binding-pool.js';
import { loadBindingNodeConfigs } from '../ledger/binding-config.js';

type Target = {
  connectionId: string;
  organizationId: string;
  chainId: string;
  bindingDigest: string;
  ownerMspId: string;
  peerEndpoint: string;
  peerHostAlias: string;
  tlsCertPath: string;
};
export function loadEnterpriseTargets(
  env: NodeJS.ProcessEnv = process.env,
): Target[] {
  if (!env.ENTERPRISE_CONNECTIONS_CONFIG) return [];
  const config = JSON.parse(
    readFileSync(env.ENTERPRISE_CONNECTIONS_CONFIG, 'utf8'),
  ) as { version: number; targets: Target[] };
  if (config.version !== 1 || !Array.isArray(config.targets))
    throw new Error('Invalid operator-owned enterprise inventory');
  const allowed = [
    'connectionId',
    'organizationId',
    'chainId',
    'bindingDigest',
    'ownerMspId',
    'peerEndpoint',
    'peerHostAlias',
    'tlsCertPath',
  ];
  const ids = new Set<string>();
  for (const entry of config.targets) {
    if (
      !entry ||
      Object.keys(entry).length !== allowed.length ||
      Object.keys(entry).some((k) => !allowed.includes(k)) ||
      allowed.some((k) => typeof entry[k as keyof Target] !== 'string') ||
      ![entry.connectionId, entry.organizationId, entry.chainId].every((id) =>
        isUUID(id),
      ) ||
      !/^[a-f0-9]{64}$/.test(entry.bindingDigest) ||
      !/^[A-Za-z][A-Za-z0-9]{0,99}$/.test(entry.ownerMspId) ||
      ids.has(entry.connectionId)
    )
      throw new Error('Invalid or duplicate enterprise target');
    ids.add(entry.connectionId);
  }
  return config.targets;
}

/** Only the private Worker reads this inventory. Submitted endpoints are never
 * dialled before they exactly match an operator-reviewed connection target. */
@Injectable()
export class EnterpriseConnectionWorker {
  public environment: NodeJS.ProcessEnv = process.env;
  constructor(
    private readonly prisma: PrismaService,
    private readonly pool: BindingConnectionPool,
  ) {}
  async processAll() {
    if (this.environment.ENTERPRISE_ONBOARDING_ENABLED !== 'true') return;
    const targets = loadEnterpriseTargets(this.environment);
    for (const target of targets) {
      const token = randomUUID();
      const claimed = await this.prisma
        .$executeRaw`UPDATE enterprise_connection SET lease_token=${token}::uuid,lease_expires_at=clock_timestamp()+interval '120 seconds',version=version+1,updated_at=clock_timestamp()
        WHERE id=${target.connectionId}::uuid AND status IN ('APPROVED','CHECKING','UNKNOWN') AND (lease_expires_at IS NULL OR lease_expires_at<=clock_timestamp())`;
      if (claimed) await this.check(target, token);
    }
  }
  private async update(
    row: EnterpriseConnection,
    token: string,
    data: Prisma.EnterpriseConnectionUpdateManyMutationInput,
  ) {
    const changed = await this.prisma.enterpriseConnection.updateMany({
      where: {
        id: row.id,
        leaseToken: token,
        leaseExpiresAt: { gt: new Date() },
      },
      data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
    });
    if (changed.count !== 1) throw new Error('CONNECTION_LEASE_LOST');
  }
  private async check(target: Target, token: string) {
    const row = await this.prisma.enterpriseConnection.findUniqueOrThrow({
      where: { id: target.connectionId },
      include: {
        enrollment: { include: { organization: true, owner: true } },
        chain: true,
      },
    });
    let remote: Awaited<ReturnType<typeof connectGateway>> | undefined;
    let mayHaveBroadcast = row.status === 'UNKNOWN';
    try {
      if (
        row.enrollment.status !== 'APPROVED' ||
        row.enrollment.organization.status !== 'ACTIVE' ||
        row.enrollment.owner.accountStatus !== 'ACTIVE' ||
        row.enrollment.owner.organizationId !== target.organizationId ||
        row.enrollment.organizationId !== target.organizationId ||
        row.chainId !== target.chainId ||
        row.chain.ownerOrganizationId !== target.organizationId
      )
        throw new Error('CONNECTION_SCOPE_MISMATCH');
      const binding = await this.prisma.fabricNetworkBinding.findUniqueOrThrow({
        where: { digest: target.bindingDigest },
        include: { state: true },
      });
      if (
        binding.chainId !== row.chainId ||
        binding.profile !== row.hostingMode ||
        binding.state?.status !== 'ACTIVE' ||
        (row.bindingDigest && row.bindingDigest !== binding.digest)
      )
        throw new Error('CONNECTION_BINDING_MISMATCH');
      // An MSP on one network is never allocated to two enterprise identities.
      const used = await this.prisma.enterpriseConnection.findMany({
        where: { status: 'CONNECTED', enrollmentId: { not: row.enrollmentId } },
        select: { evidence: true },
      });
      if (
        used.some((c) => {
          const e = c.evidence as Record<string, unknown>;
          return (
            e.network === binding.network && e.ownerMsp === target.ownerMspId
          );
        })
      )
        throw new Error('CONNECTION_MSP_ALREADY_ASSIGNED');
      const tls = readFileSync(target.tlsCertPath, 'utf8');
      const allocated = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO enterprise_msp_allocation(network,msp_id,organization_id) VALUES (${binding.network},${target.ownerMspId},${target.organizationId}::uuid) ON CONFLICT DO NOTHING`;
        const owners = await tx.$queryRaw<
          Array<{ organization_id: string }>
        >`SELECT organization_id FROM enterprise_msp_allocation WHERE network=${binding.network} AND msp_id=${target.ownerMspId}`;
        return owners[0]?.organization_id === target.organizationId;
      });
      if (!allocated) throw new Error('CONNECTION_MSP_ALREADY_ASSIGNED');
      if (row.hostingMode === 'SELF_MANAGED_ORG') {
        const config = row.publicConfig as Record<string, unknown>;
        const endpoint = `${String(config.peerHost).includes(':') ? '[' + String(config.peerHost) + ']' : config.peerHost}:${config.peerPort}`;
        if (
          endpoint !== target.peerEndpoint ||
          config.peerServerName !== target.peerHostAlias ||
          config.mspId !== target.ownerMspId ||
          new X509Certificate(String(config.tlsCaPem)).fingerprint256 !==
            new X509Certificate(tls).fingerprint256
        )
          throw new Error('CONNECTION_CONFIG_NOT_APPROVED');
      }
      const writer = loadBindingNodeConfigs(this.environment).find(
        (c) => c.bindingDigest === binding.digest,
      );
      if (!writer) throw new Error('CONNECTION_WRITER_NOT_CONFIGURED');
      remote = await connectGateway({
        channelName: binding.channelId,
        chaincodeName: binding.chaincodeName,
        contractName: binding.contractName,
        mspId: binding.writerMspId,
        peerEndpoint: target.peerEndpoint,
        peerHostAlias: target.peerHostAlias,
        tlsCertPath: target.tlsCertPath,
        identityCertPath: writer.relayer.certPath,
        identityKeyDirectory: writer.relayer.keyDir,
      });
      const reader = new BindingLedgerClient(remote.gateway, {
        channelName: binding.channelId,
        chaincodeName: binding.chaincodeName,
        contractName: binding.contractName,
      });
      const connection = await this.pool.get(binding, 'relayer');
      const remoteHealth = (await reader.health()) as {
        governanceDigest?: string;
        supportedWriteVersions?: string[];
      };
      if (
        remoteHealth.governanceDigest !== binding.governanceDigest ||
        !remoteHealth.supportedWriteVersions?.includes('6.0.0')
      )
        throw new Error('CONNECTION_CAPABILITY_MISMATCH');
      let proof: Record<string, unknown> | null = null;
      try {
        proof = (await reader.query(
          'GetConnectionProbe',
          binding.digest,
          row.challenge,
        )) as Record<string, unknown>;
      } catch (error) {
        if (!/NOT_FOUND|does not exist/.test(String(error))) throw error;
      }
      if (!proof && !row.txId) {
        const prepared = connection.client.prepare(
          'RecordConnectionProbe',
          [binding.digest, row.challenge, target.organizationId],
          { endorsingOrganizations: [binding.writerMspId, target.ownerMspId] },
        );
        await this.update(row, token, {
          status: 'CHECKING',
          bindingDigest: binding.digest,
          txId: prepared.transactionId,
        });
        row.txId = prepared.transactionId;
        const endorsed = await prepared.endorse();
        // Persisted txId makes crash or loss of commit response read-only recovery.
        await this.update(row, token, { status: 'UNKNOWN' });
        mayHaveBroadcast = true;
        const outcome = await endorsed.submit();
        if (!outcome.successful) throw new Error('CONNECTION_COMMIT_INVALID');
        proof = (await reader.query(
          'GetConnectionProbe',
          binding.digest,
          row.challenge,
        )) as Record<string, unknown>;
      }
      if (!proof) {
        if (row.txId && !mayHaveBroadcast)
          throw new Error('CONNECTION_PREPARE_INTERRUPTED');
        const validation = row.txId
          ? await connection.client.transactionValidationCode(row.txId)
          : null;
        if (validation !== null && validation !== 0)
          throw new Error('CONNECTION_COMMIT_INVALID');
        await this.update(row, token, {
          status: 'UNKNOWN',
          errorCode: 'CONNECTION_RECONCILING',
          leaseToken: null,
          leaseExpiresAt: new Date(Date.now() + 30_000),
        });
        return;
      }
      if (
        proof.txId !== row.txId ||
        proof.challenge !== row.challenge ||
        proof.organizationRef !== target.organizationId ||
        proof.bindingDigest !== binding.digest ||
        proof.ownerMsp !== target.ownerMspId ||
        proof.writerMsp !== binding.writerMspId ||
        proof.channelId !== binding.channelId ||
        proof.governanceDigest !== binding.governanceDigest ||
        (await connection.client.transactionValidationCode(row.txId!)) !== 0
      )
        throw new Error('CONNECTION_PROOF_MISMATCH');
      const localProof = await connection.client.query(
        'GetConnectionProbe',
        binding.digest,
        row.challenge,
      );
      if (JSON.stringify(localProof) !== JSON.stringify(proof))
        throw new Error('CONNECTION_PROOF_MISMATCH');
      await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${target.organizationId}::uuid FOR SHARE`;
        await tx.$queryRaw`SELECT user_id FROM app_user WHERE user_id=${row.enrollment.ownerId}::uuid FOR SHARE`;
        const owner = await tx.user.findUniqueOrThrow({
          where: { id: row.enrollment.ownerId },
          include: { organization: true },
        });
        if (
          owner.accountStatus !== 'ACTIVE' ||
          owner.organizationId !== target.organizationId ||
          owner.organization?.status !== 'ACTIVE'
        )
          throw new Error('CONNECTION_SCOPE_MISMATCH');
        const updated = await tx.enterpriseConnection.updateMany({
          where: {
            id: row.id,
            leaseToken: token,
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: 'CONNECTED',
            evidence: { ...proof, network: binding.network },
            checkedAt: new Date(),
            errorCode: null,
            leaseToken: null,
            leaseExpiresAt: null,
            version: { increment: 1 },
            updatedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new Error('CONNECTION_LEASE_LOST');
      });
    } catch (error) {
      const message = String(error);
      if (message.includes('CONNECTION_LEASE_LOST')) return;
      const code =
        /CONNECTION_[A-Z_]+/.exec(message)?.[0] ?? 'CONNECTION_UNAVAILABLE';
      // A txId that may have left this process is never discarded or replaced.
      const terminal =
        code === 'CONNECTION_COMMIT_INVALID' ||
        (!mayHaveBroadcast &&
          (!!row.txId ||
            [
              'CONNECTION_SCOPE_MISMATCH',
              'CONNECTION_BINDING_MISMATCH',
              'CONNECTION_CONFIG_NOT_APPROVED',
              'CONNECTION_MSP_ALREADY_ASSIGNED',
              'CONNECTION_PROOF_MISMATCH',
            ].includes(code)));
      await this.update(row, token, {
        status: terminal ? 'FAILED' : row.txId ? 'UNKNOWN' : 'APPROVED',
        errorCode: code,
        leaseToken: null,
        leaseExpiresAt: new Date(Date.now() + 30_000),
      }).catch(() => undefined);
    } finally {
      remote?.close();
    }
  }
}
