import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RegistryOperator } from '@agri-trace/fabric-gateway';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  BindingConnectionPool,
  type BindingConnection,
} from './binding-pool.js';
import {
  activateBinding,
  registerBinding,
  recordCredential,
} from './ledger-bindings.js';
import { onboardBindingOnLedger } from './ledger-onboarding.js';
import {
  activateSigningKey,
  registerSigningKeyOnLedger,
} from './ledger-signing.js';
import {
  loadPlatformLedgerConfig,
  matchesPlatform,
} from './platform-ledger-config.js';

/** Database queue -> reviewed shared Fabric target. Each retry resumes the same binding/proposals. */
@Injectable()
export class PlatformProvisioningWorker {
  public environment: NodeJS.ProcessEnv = process.env;
  constructor(
    private readonly db: PrismaService,
    private readonly pool: BindingConnectionPool,
  ) {}

  async processAll(): Promise<void> {
    const config = loadPlatformLedgerConfig(this.environment);
    if (!config) return;
    this.pool.setPlatformBindings(
      await this.db.fabricNetworkBinding.findMany(),
    );
    // Claim one at a time: queued work must not lose its lease while earlier work runs.
    for (let i = 0; i < 10; i++) {
      const token = randomUUID();
      const rows = await this.db.$queryRaw<Array<{ chain_id: string }>>`
        UPDATE ledger_provisioning_job SET status='PROCESSING', lease_token=${token}::uuid,
          lease_expires_at=clock_timestamp()+interval '120 seconds', attempts=attempts+1
        WHERE chain_id=(SELECT chain_id FROM ledger_provisioning_job
          WHERE (status='PENDING' AND (next_attempt_at IS NULL OR next_attempt_at<=clock_timestamp()))
             OR (status='PROCESSING' AND lease_expires_at<=clock_timestamp())
          ORDER BY created_at,chain_id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING chain_id`;
      if (!rows.length) break;
      const chainId = rows[0].chain_id;
      let lost = false;
      const heartbeat = setInterval(() => {
        void this.db.ledgerProvisioningJob
          .updateMany({
            where: {
              chainId,
              leaseToken: token,
              status: 'PROCESSING',
              leaseExpiresAt: { gt: new Date() },
            },
            data: { leaseExpiresAt: new Date(Date.now() + 120_000) },
          })
          .then(
            (r) => {
              if (!r.count) lost = true;
            },
            () => {
              lost = true;
            },
          );
      }, 30_000);
      let controller: BindingConnection | undefined,
        admin: BindingConnection | undefined;
      try {
        const binding = await this.db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT chain_id FROM ledger_provisioning_job WHERE chain_id=${chainId}::uuid FOR UPDATE`;
          const job = await tx.ledgerProvisioningJob.findUniqueOrThrow({
            where: { chainId },
          });
          if (
            job.leaseToken !== token ||
            !job.leaseExpiresAt ||
            job.leaseExpiresAt <= new Date()
          )
            throw new Error('PROVISIONING_LEASE_LOST');
          const current = job.bindingDigest
            ? await tx.fabricNetworkBinding.findUniqueOrThrow({
                where: { digest: job.bindingDigest },
              })
            : null;
          if (current && !matchesPlatform(config, current))
            throw new Error('PROVISIONING_TARGET_CHANGED');
          if (current) return current;
          const profile = await tx.chainLedgerProfile.findUnique({
            where: { chainId },
          });
          if (profile?.activeBindingDigest) {
            const active = await tx.fabricNetworkBinding.findUniqueOrThrow({
              where: { digest: profile.activeBindingDigest },
            });
            if (!matchesPlatform(config, active))
              throw new Error('PROVISIONING_EXISTING_TARGET_MISMATCH');
            await tx.ledgerProvisioningJob.update({
              where: { chainId },
              data: { bindingDigest: active.digest },
            });
            return active;
          }
          const created = await registerBinding(tx, {
            chainId,
            network: config.network,
            channelId: config.channelId,
            chaincodeName: config.chaincodeName,
            contractName: config.contractName,
            writerAuthority: config.writerAuthority,
            writerMspId: 'AgritraceMSP',
            governanceDigest: config.governanceDigest,
            profile: 'SERVICE',
          });
          await tx.ledgerProvisioningJob.update({
            where: { chainId },
            data: { bindingDigest: created.digest },
          });
          return tx.fabricNetworkBinding.findUniqueOrThrow({
            where: { digest: created.digest },
          });
        });
        this.pool.addPlatformBinding(binding);
        // Controller can read health before the relayer credential is registered.
        controller = await this.pool.get(binding, 'controller');
        admin = await this.pool.get(binding, 'admin');
        const operator = new RegistryOperator(controller.client, {
          AgritraceMSP: admin.client,
        });
        const fingerprint = await this.pool.fingerprint(binding, 'relayer');
        await onboardBindingOnLedger({
          operator,
          reader: controller.client,
          channelId: binding.channelId,
          approvers: ['AgritraceMSP'],
          binding,
          relayerFingerprint: fingerprint,
        });
        if (lost) throw new Error('PROVISIONING_LEASE_LOST');
        // Only mirror a credential that the ledger actually reports ACTIVE.
        const credential = (await controller.client.query(
          'GetRegistryCredential',
          binding.digest,
          binding.writerAuthority,
          fingerprint,
        )) as { status?: string };
        if (credential.status !== 'ACTIVE')
          throw new Error('PROVISIONING_CREDENTIAL_NOT_CONFIRMED');
        await this.db.$transaction(async (tx) => {
          const owned = await tx.ledgerProvisioningJob.updateMany({
            where: {
              chainId,
              leaseToken: token,
              status: 'PROCESSING',
              leaseExpiresAt: { gt: new Date() },
            },
            data: { lastError: null },
          });
          if (!owned.count) throw new Error('PROVISIONING_LEASE_LOST');
          await recordCredential(tx, binding.digest, fingerprint);
          await activateBinding(tx, binding.digest);
          await tx.ledgerProvisioningJob.update({
            where: { chainId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
        });
      } catch {
        // Keep the original binding and stable proposal nonces on uncertain outcomes.
        await this.db.ledgerProvisioningJob.updateMany({
          where: {
            chainId,
            leaseToken: token,
            status: 'PROCESSING',
            leaseExpiresAt: { gt: new Date() },
          },
          data: {
            status: 'PENDING',
            nextAttemptAt: new Date(Date.now() + 30_000),
            lastError:
              'Không thể hoàn tất chuẩn bị ledger; hệ thống đang đối soát và thử lại.',
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      } finally {
        clearInterval(heartbeat);
        this.pool.release(controller);
        this.pool.release(admin);
      }
    }
    // Public keys only. A revoked key is never reactivated by a late registration.
    const keys = await this.db.signingKey.findMany({
      where: {
        status: 'PENDING_LEDGER',
        binding: { state: { status: 'ACTIVE' }, profile: 'SERVICE' },
      },
      include: { binding: true },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
    for (const key of keys) {
      if (!matchesPlatform(config, key.binding)) continue;
      let controller: BindingConnection | undefined,
        admin: BindingConnection | undefined;
      try {
        this.pool.addPlatformBinding(key.binding);
        controller = await this.pool.get(key.binding, 'controller');
        admin = await this.pool.get(key.binding, 'admin');
        await registerSigningKeyOnLedger({
          operator: new RegistryOperator(controller.client, {
            AgritraceMSP: admin.client,
          }),
          reader: controller.client,
          approvers: ['AgritraceMSP'],
          key,
        });
        await activateSigningKey(this.db, key.keyRef);
      } catch {
        /* Same key/proposal is retried; no unsigned fallback. */
      } finally {
        this.pool.release(controller);
        this.pool.release(admin);
      }
    }
  }
}
