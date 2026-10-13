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
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT j.job_id AS id FROM ledger_control_job j
        WHERE (
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
      await tx.ledgerControlJob.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + lease),
          updatedAt: new Date(),
        },
      });
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
      await this.prisma.ledgerControlJob.update({
        where: { id: job.id },
        data: {
          status: 'COMPLETED',
          receipt: outcome as Prisma.InputJsonValue,
          lastError: null,
          leaseToken: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      await this.failure(job, error);
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
    const ref = job.permissionRef!;
    const epoch = job.epoch!;
    const sync = await this.prisma.ledgerPermissionSync.findUniqueOrThrow({
      where: { permissionRef: ref },
    });
    if (job.operation === 'PERMISSION_GRANT') {
      if (sync.requestedEpoch === epoch && sync.state === 'REQUESTED')
        await this.setSync(ref, { state: 'PENDING_LEDGER' });
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
      const current = await this.prisma.ledgerPermissionSync.findUniqueOrThrow({
        where: { permissionRef: ref },
      });
      if (current.requestedEpoch === epoch)
        await this.setSync(ref, {
          ...(current.state === 'PENDING_LEDGER' ? { state: 'ACTIVE' } : {}),
          confirmedEpoch: epoch,
          lastTxId: view.executedTxId ?? null,
        });
      return { proposalId: view.proposalId, txId: view.executedTxId ?? null };
    }
    if (sync.requestedEpoch !== epoch) return { outcome: 'SUPERSEDED' };
    if (job.operation === 'PERMISSION_REVOKE') {
      if (sync.state === 'REVOKED') return { outcome: 'ALREADY_REVOKED' };
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
      if (sync.state === 'REVOKE_REQUESTED')
        await this.setSync(ref, { state: 'DRAINING' });
      if (['REVOKE_REQUESTED', 'DRAINING'].includes(sync.state))
        await this.setSync(ref, { state: 'PENDING_REVOKE_LEDGER' });
      const view = await this.applyRevoke(
        operator,
        'PERMISSION_REVOKE',
        job,
        msp,
      );
      await this.setSync(ref, { state: 'REVOKED', lastTxId: view.txId });
      return view;
    }
    // Emergency: revoke now, keep the hold until a reviewer resolves it.
    if (sync.state === 'REVOKED_REVIEW_REQUIRED')
      return { outcome: 'ALREADY_REVOKED' };
    if (sync.state === 'EMERGENCY_HOLD')
      await this.setSync(ref, { state: 'PENDING_EMERGENCY_REVOKE' });
    const view = await this.applyRevoke(
      operator,
      'PERMISSION_EMERGENCY_REVOKE',
      job,
      msp,
    );
    await this.setSync(ref, {
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
    ref: string,
    data: {
      state?: Prisma.LedgerPermissionSyncUpdateInput['state'];
      confirmedEpoch?: number;
      lastTxId?: string | null;
    },
  ) {
    await this.prisma.ledgerPermissionSync.update({
      where: { permissionRef: ref },
      data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
    });
  }

  private async defer(
    job: Job,
    delayMs: number,
    reason: string,
    spendNothing: boolean,
  ) {
    await this.prisma.ledgerControlJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        attemptCount: spendNothing ? { decrement: 1 } : undefined,
        nextAttemptAt: new Date(Date.now() + delayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: reason,
        updatedAt: new Date(),
      },
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
    this.pool.invalidate(job.bindingDigest);
    const exhausted = job.attemptCount >= MAX_ATTEMPTS;
    await this.prisma.ledgerControlJob.update({
      where: { id: job.id },
      data: {
        status: permanent || exhausted ? 'FAILED' : 'PENDING',
        nextAttemptAt: new Date(
          Date.now() + Math.min(120_000, 2 ** job.attemptCount * 1000),
        ),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
        updatedAt: new Date(),
      },
    });
    this.logger.warn(
      `Control job ${job.id} ${permanent || exhausted ? 'failed' : 'will retry'}: ${message}`,
    );
  }

  private number(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
}
