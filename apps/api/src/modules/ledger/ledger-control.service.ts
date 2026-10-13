import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  RegistryOperator,
  classifyFabricError,
} from '@agri-trace/fabric-gateway';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BindingConnectionPool, type BindingTarget } from './binding-pool.js';

type Job = Prisma.LedgerControlJobGetPayload<{ include: { binding: true } }>;
type Sync = Prisma.LedgerPermissionSyncGetPayload<object>;
const MAX_ATTEMPTS = 8;

/** Executes ledger permission and fence changes. The DB never claims a
 * permission is ACTIVE until the ledger confirmed the exact epoch; a revoke
 * waits for a barrier drain, an emergency revoke does not. */
@Injectable()
export class LedgerControlService {
  private readonly logger = new Logger(LedgerControlService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pool: BindingConnectionPool,
  ) {}

  public async processAll(limit = 10): Promise<number> {
    const jobs = await this.claim(limit);
    for (const job of jobs) await this.run(job);
    return jobs.length;
  }

  private async claim(limit: number): Promise<Job[]> {
    const lease = this.number('FABRIC_CLAIM_LEASE_MS', 120_000);
    const token = randomUUID();
    // A binding this Worker has no controller/admin identity for must not
    // starve the others: its jobs are simply not ours to claim.
    const digests = this.pool.configuredDigests(['controller', 'admin']);
    if (!digests.length) return [];
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT j.job_id AS id FROM ledger_control_job j
        WHERE j.binding_digest = ANY(${digests}::text[]) AND (
            (j.status = 'PENDING'::ledger_control_status AND (j.next_attempt_at IS NULL OR j.next_attempt_at <= now()))
            OR (j.status = 'PROCESSING'::ledger_control_status AND j.lease_expires_at <= now())
          )
          AND (
            j.operation NOT IN ('PERMISSION_REVOKE'::ledger_control_operation, 'PERMISSION_EMERGENCY_REVOKE'::ledger_control_operation)
            OR NOT EXISTS (
              SELECT 1 FROM ledger_control_job g
              WHERE g.operation = 'PERMISSION_GRANT'::ledger_control_operation
                AND g.permission_ref = j.permission_ref AND g.epoch = j.epoch
                AND g.status IN ('PENDING'::ledger_control_status, 'PROCESSING'::ledger_control_status))
          )
        ORDER BY j.created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (!rows.length) return [];
      const ids = rows.map((row) => row.id);
      await tx.$executeRaw`UPDATE ledger_control_job
        SET status = 'PROCESSING'::ledger_control_status,
            attempt_count = attempt_count + 1, lease_token = ${token}::uuid,
            lease_expires_at = clock_timestamp() + ${lease} * interval '1 millisecond',
            updated_at = clock_timestamp()
        WHERE job_id = ANY(${ids}::uuid[])`;
      return tx.ledgerControlJob.findMany({
        where: { id: { in: ids }, leaseToken: token },
        include: { binding: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private target(job: Job): BindingTarget {
    const binding = job.binding;
    return {
      digest: binding.digest,
      channelId: binding.channelId,
      chaincodeName: binding.chaincodeName,
      contractName: binding.contractName,
      writerMspId: binding.writerMspId,
      governanceDigest: binding.governanceDigest,
    };
  }

  private async run(job: Job): Promise<void> {
    // Jobs claimed in a batch may have waited while earlier jobs used the
    // network. An expired claim must never be revived by the old worker.
    if (!(await this.renew(job))) return;
    const heartbeat = setInterval(() => {
      void this.renew(job).catch((error: unknown) => {
        this.logger.warn(
          `Control job ${job.id} lease renewal failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
      });
    }, Math.max(100, Math.floor(this.number('FABRIC_CLAIM_LEASE_MS', 120_000) / 3)));
    heartbeat.unref();
    try {
      if (
        !this.pool.configured(job.bindingDigest, 'controller') ||
        !this.pool.configured(job.bindingDigest, 'admin')
      ) {
        await this.defer(
          job,
          30_000,
          'No controller/admin identity configured for this binding',
          false,
        );
        return;
      }
      const target = this.target(job);
      const controller = await this.pool.get(target, 'controller');
      const admin = await this.pool.get(target, 'admin');
      const operator = new RegistryOperator(controller.client, {
        [job.binding.writerMspId]: admin.client,
      });
      const outcome = await this.execute(job, operator, controller.client);
      if (outcome === 'DEFER') return;
      await this.writeOwned(job, {
          status: 'COMPLETED',
          receipt: outcome as Prisma.InputJsonValue,
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
      });
    } catch (error) {
      await this.failure(job, error);
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async execute(
    job: Job,
    operator: RegistryOperator,
    client: {
      getDeliveryFence(chainRef: string, eventId: string): Promise<unknown>;
    },
  ): Promise<Record<string, unknown> | 'DEFER'> {
    const msp = job.binding.writerMspId;
    if (job.operation === 'FENCE_DELIVERY') {
      const event = await this.prisma.traceEvent.findUniqueOrThrow({
        where: { id: job.eventId! },
      });
      const fence = (await client.getDeliveryFence(
        job.binding.chainRef,
        event.id,
      )) as { revision?: number };
      const view = await operator.apply(
        'FENCE_DELIVERY',
        {
          chainRef: job.binding.chainRef,
          bindingDigest: job.bindingDigest,
          eventId: event.id,
          dataHash: event.dataHash,
        },
        [msp],
        String(fence.revision ?? job.expectedRevision),
        job.nonce,
      );
      return {
        proposalId: view.proposalId,
        result: view.result ?? null,
        txId: view.executedTxId ?? null,
      };
    }
    if (job.operation === 'SIGNING_KEY_REVOKE') {
      // The DB revoked the key first, so no new intent can use it; this
      // withdraws it from the ledger registry. Either MSP may revoke.
      const view = await operator.apply(
        'SIGNING_KEY_REVOKE',
        { bindingDigest: job.bindingDigest, keyRef: job.signingKeyRef! },
        [msp],
        String(job.expectedRevision),
        job.nonce,
      );
      return { proposalId: view.proposalId, txId: view.executedTxId ?? null };
    }
    const ref = job.permissionRef!;
    const epoch = job.epoch!;
    let sync = await this.prisma.ledgerPermissionSync.findUniqueOrThrow({
      where: { permissionRef: ref },
    });
    if (sync.requestedEpoch !== epoch) return { outcome: 'SUPERSEDED' };
    if (job.operation === 'PERMISSION_GRANT') {
      if (sync.state === 'ACTIVE' && sync.confirmedEpoch === epoch)
        return { outcome: 'ALREADY_ACTIVE' };
      if (sync.state === 'REQUESTED') {
        const pending = await this.setSync(job, sync, { state: 'PENDING_LEDGER' });
        if (!pending) return { outcome: 'SUPERSEDED' };
        sync = pending;
      }
      if (sync.state !== 'PENDING_LEDGER') return { outcome: 'SUPERSEDED' };
      const permissionEpoch =
        await this.prisma.ledgerPermissionEpoch.findUniqueOrThrow({
          where: { permissionRef_epoch: { permissionRef: ref, epoch } },
        });
      const view = await operator.apply(
        'PERMISSION_GRANT',
        {
          permissionRef: ref,
          bindingDigest: job.bindingDigest,
          epoch: String(epoch),
          entityTypes: permissionEpoch.entityTypes,
        },
        [msp],
        String(job.expectedRevision),
        job.nonce,
      );
      await this.setSync(job, sync, {
          state: 'ACTIVE',
          confirmedEpoch: epoch,
          lastTxId: view.executedTxId ?? null,
      });
      return { proposalId: view.proposalId, txId: view.executedTxId ?? null };
    }
    if (job.operation === 'PERMISSION_REVOKE') {
      if (sync.state === 'REVOKED') return { outcome: 'ALREADY_REVOKED' };
      if (!['REVOKE_REQUESTED', 'DRAINING', 'PENDING_REVOKE_LEDGER'].includes(sync.state))
        return { outcome: 'SUPERSEDED' };
      // Drain: every event captured at or before the barrier must be VALID on
      // the ledger. Dead-lettered or unknown events never count as drained.
      const blocked = await this.undrained(
        ref,
        epoch,
        sync.barrierOrdinal ?? 0n,
      );
      if (blocked > 0) {
        await this.defer(
          job,
          5_000,
          `Drain blocked by ${blocked} unconfirmed event(s)`,
          true,
        );
        return 'DEFER';
      }
      if (sync.state === 'REVOKE_REQUESTED') {
        const draining = await this.setSync(job, sync, { state: 'DRAINING' });
        if (!draining) return { outcome: 'SUPERSEDED' };
        sync = draining;
      }
      if (sync.state === 'DRAINING') {
        const pending = await this.setSync(job, sync, { state: 'PENDING_REVOKE_LEDGER' });
        if (!pending) return { outcome: 'SUPERSEDED' };
        sync = pending;
      }
      const view = await this.applyRevoke(
        operator,
        'PERMISSION_REVOKE',
        job,
        msp,
      );
      await this.setSync(job, sync, { state: 'REVOKED', lastTxId: view.txId });
      return view;
    }
    // Emergency: revoke now, keep the hold until a reviewer resolves it.
    if (sync.state === 'REVOKED_REVIEW_REQUIRED')
      return { outcome: 'ALREADY_REVOKED' };
    if (sync.state === 'EMERGENCY_HOLD') {
      const pending = await this.setSync(job, sync, { state: 'PENDING_EMERGENCY_REVOKE' });
      if (!pending) return { outcome: 'SUPERSEDED' };
      sync = pending;
    }
    if (sync.state !== 'PENDING_EMERGENCY_REVOKE')
      return { outcome: 'SUPERSEDED' };
    const view = await this.applyRevoke(
      operator,
      'PERMISSION_EMERGENCY_REVOKE',
      job,
      msp,
    );
    await this.setSync(job, sync, {
      state: 'REVOKED_REVIEW_REQUIRED',
      lastTxId: view.txId,
    });
    return view;
  }

  private async applyRevoke(
    operator: RegistryOperator,
    kind: 'PERMISSION_REVOKE' | 'PERMISSION_EMERGENCY_REVOKE',
    job: Job,
    msp: string,
  ): Promise<{
    proposalId: string | null;
    txId: string | null;
    outcome?: string;
  }> {
    try {
      const view = await operator.apply(
        kind,
        { permissionRef: job.permissionRef!, epoch: String(job.epoch) },
        [msp],
        String(job.expectedRevision),
        job.nonce,
      );
      return { proposalId: view.proposalId, txId: view.executedTxId ?? null };
    } catch (error) {
      const failure = classifyFabricError(error);
      // The ledger grant never committed: there is nothing to revoke there.
      if (failure.kind === 'CHAINCODE' && failure.chaincodeCode === 'NOT_FOUND')
        return { proposalId: null, txId: null, outcome: 'NOTHING_ON_LEDGER' };
      throw error;
    }
  }

  private async undrained(
    ref: string,
    epoch: number,
    barrier: bigint,
  ): Promise<number> {
    const [row] = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n
      FROM event_permission_epoch ep
      LEFT JOIN blockchain_proof bp ON bp.event_id = ep.event_id
      WHERE ep.permission_ref = ${ref}::uuid AND ep.epoch = ${epoch}
        AND ep.ordinal <= ${barrier}
        AND bp.transaction_status IS DISTINCT FROM 'CONFIRMED'::blockchain_transaction_status`;
    return Number(row.n);
  }

  private async setSync(
    job: Job,
    expected: Sync,
    data: {
      state?: Prisma.LedgerPermissionSyncUpdateInput['state'];
      confirmedEpoch?: number;
      lastTxId?: string | null;
    },
  ): Promise<Sync | null> {
    return this.prisma.$transaction(async (tx) => {
      // API revoke/regrant uses permission -> control-job lock order too.
      // Keep that order so a network completion cannot deadlock or overwrite
      // a newer hold/epoch, even if its job claim is still current.
      await tx.$queryRaw`SELECT permission_ref FROM ledger_permission_sync
        WHERE permission_ref = ${expected.permissionRef}::uuid FOR UPDATE`;
      const [owned] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT job_id AS id FROM ledger_control_job
        WHERE job_id = ${job.id}::uuid AND status = 'PROCESSING'::ledger_control_status
          AND lease_token = ${job.leaseToken}::uuid AND lease_expires_at > clock_timestamp()
        FOR UPDATE`;
      if (!owned) return null;
      const updated = await tx.ledgerPermissionSync.updateMany({
        where: {
          permissionRef: expected.permissionRef,
          requestedEpoch: expected.requestedEpoch,
          state: expected.state,
          version: expected.version,
        },
        data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (updated.count !== 1) return null;
      return tx.ledgerPermissionSync.findUniqueOrThrow({
        where: { permissionRef: expected.permissionRef },
      });
    });
  }

  private owned(job: Job): Prisma.LedgerControlJobWhereInput {
    return {
      id: job.id,
      status: 'PROCESSING',
      leaseToken: job.leaseToken,
    };
  }

  private async renew(job: Job): Promise<boolean> {
    if (!job.leaseToken) return false;
    const lease = this.number('FABRIC_CLAIM_LEASE_MS', 120_000);
    const count = await this.prisma.$executeRaw`UPDATE ledger_control_job
      SET lease_expires_at = clock_timestamp() + ${lease} * interval '1 millisecond',
          updated_at = clock_timestamp()
      WHERE job_id = ${job.id}::uuid AND status = 'PROCESSING'::ledger_control_status
        AND lease_token = ${job.leaseToken}::uuid AND lease_expires_at > clock_timestamp()`;
    return count === 1;
  }

  private async writeOwned(job: Job, data: Prisma.LedgerControlJobUpdateManyMutationInput) {
    if (!job.leaseToken) return { count: 0 };
    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT job_id AS id FROM ledger_control_job
        WHERE job_id = ${job.id}::uuid AND status = 'PROCESSING'::ledger_control_status
          AND lease_token = ${job.leaseToken}::uuid AND lease_expires_at > clock_timestamp()
        FOR UPDATE`;
      if (!row) return { count: 0 };
      return tx.ledgerControlJob.updateMany({ where: this.owned(job), data });
    });
  }

  private async defer(
    job: Job,
    delayMs: number,
    reason: string,
    spendNothing: boolean,
  ) {
    await this.writeOwned(job, {
        status: 'PENDING',
        attemptCount: spendNothing ? { decrement: 1 } : undefined,
        nextAttemptAt: new Date(Date.now() + delayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: reason,
        updatedAt: new Date(),
    });
  }

  private async failure(job: Job, error: unknown) {
    const failure = classifyFabricError(error);
    const message =
      `${failure.chaincodeCode ?? failure.kind}: ${failure.message}`.slice(
        0,
        1000,
      );
    const permanent =
      failure.kind === 'CHAINCODE' &&
      [
        'REVISION_CONFLICT',
        'INVALID_INPUT',
        'APPROVALS_MISSING',
        'UNAUTHORIZED_CONTROL',
      ].includes(failure.chaincodeCode ?? '');
    const exhausted = job.attemptCount >= MAX_ATTEMPTS;
    const updated = await this.writeOwned(job, {
        status: permanent || exhausted ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(
          Date.now() + Math.min(120_000, 2 ** job.attemptCount * 1000),
        ),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
        updatedAt: new Date(),
    });
    if (updated.count !== 1) return;
    this.pool.invalidate(job.bindingDigest);
    this.logger.warn(
      `Control job ${job.id} ${permanent || exhausted ? 'failed' : 'will retry'}: ${message}`,
    );
  }

  private number(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
}
