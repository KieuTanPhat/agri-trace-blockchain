import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { classifyFabricError } from '@agri-trace/fabric-gateway';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { harvestSensorTraceEvidenceMatches } from '../iot/harvest-sensor-evidence.js';
import {
  EVENT_BINDING_CONTEXT_INCLUDE,
  EVENT_LEDGER_ROUTE_INCLUDE,
  verifiedEventRoute,
} from '../trace/ledger-route.js';
import { privateTraceEvidenceMatches } from '../trace/trace-evidence.js';
import {
  BindingConnectionPool,
  type BindingConnection,
  type BindingTarget,
} from './binding-pool.js';

const CLAIM_INCLUDE = {
  traceEvent: {
    include: {
      ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
      bindingContext: EVENT_BINDING_CONTEXT_INCLUDE,
      blockchainProof: true,
    },
  },
} as const;

type Claimed = Prisma.BlockchainOutboxGetPayload<{
  include: typeof CLAIM_INCLUDE;
}>;
type Binding = Prisma.FabricNetworkBindingGetPayload<{
  include: { state: true };
}>;

/** Ledger codes that a registry/governance action fixes: keep the event
 * pending and slow down instead of burning the retry budget or dead-lettering. */
const WAIT_CODES = new Set([
  'PERMISSION_INACTIVE',
  'BINDING_UNKNOWN',
  'UNAUTHORIZED_RELAYER',
  'DELIVERY_FENCED',
  'CHANNEL_NOT_BOOTSTRAPPED',
]);
const PERMANENT_CODES = new Set([
  'INVALID_INPUT',
  'HASH_CHAIN_CONFLICT',
  'DUPLICATE_EVENT_CONFLICT',
  'BINDING_MISMATCH',
]);
const TERMINAL = ['VALID', 'INVALID', 'ABANDONED'];

class PermanentDeliveryError extends Error {}

type LedgerProof = {
  eventId: string;
  chainRef: string;
  bindingDigest: string;
  entityType: string;
  entityId: string;
  eventType: string;
  eventTime: string;
  dataHash: string;
  previousEventHash: string | null;
  privateBodyDigest: string;
  permissions: Array<{ permissionRef: string; epoch: string; ordinal: string }>;
  txId: string;
  channelId: string;
  recordedAt: string;
};

/** Delivers release-B events binding by binding. A failing binding never
 * consumes the batch of another, every attempt is recorded before it leaves
 * the process, and an unknown outcome is reconciled or fenced, never blindly
 * resent. */
@Injectable()
export class BindingDeliveryService {
  private readonly logger = new Logger(BindingDeliveryService.name);
  private readonly breaker = new Map<
    string,
    { until: number; failures: number }
  >();

  public constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly pool: BindingConnectionPool,
  ) {}

  public async processAll(
    limit = this.number('FABRIC_WORKER_BATCH_SIZE', 20),
  ): Promise<{ processed: number; failedBindings: string[] }> {
    const bindings = await this.prisma.fabricNetworkBinding.findMany({
      where: { state: { is: { status: 'ACTIVE' } } },
      include: { state: true },
      orderBy: { createdAt: 'asc' },
    });
    let processed = 0;
    const failedBindings: string[] = [];
    // Round-robin with a small per-binding quota: fairness by construction.
    for (const binding of bindings) {
      if (!this.pool.configured(binding.digest, 'relayer')) continue;
      const hold = this.breaker.get(binding.digest);
      if (hold && hold.until > Date.now()) continue;
      try {
        processed += await this.processBinding(binding, limit);
        this.breaker.delete(binding.digest);
      } catch (error) {
        const failures = (hold?.failures ?? 0) + 1;
        this.breaker.set(binding.digest, {
          failures,
          until: Date.now() + Math.min(60_000, 1000 * 2 ** failures),
        });
        this.pool.invalidate(binding.digest);
        failedBindings.push(binding.digest);
        this.logger.warn(
          `Binding ${binding.digest.slice(0, 12)} unavailable: ${(error as Error).message}`,
        );
      }
    }
    return { processed, failedBindings };
  }

  public target(binding: Binding): BindingTarget {
    return {
      digest: binding.digest,
      channelId: binding.channelId,
      chaincodeName: binding.chaincodeName,
      contractName: binding.contractName,
      writerMspId: binding.writerMspId,
      governanceDigest: binding.governanceDigest,
    };
  }

  private async processBinding(
    binding: Binding,
    limit: number,
  ): Promise<number> {
    const connection = await this.pool.get(this.target(binding), 'relayer');
    const jobs = await this.claim(binding, limit);
    for (const job of jobs) await this.deliver(job, binding, connection);
    return jobs.length;
  }

  private async claim(binding: Binding, limit: number): Promise<Claimed[]> {
    const maxRetries = this.number('FABRIC_MAX_RETRIES', 5);
    const leaseMs = this.number('FABRIC_CLAIM_LEASE_MS', 120_000);
    const leaseToken = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bo.outbox_id AS id
        FROM blockchain_outbox bo
        JOIN trace_event te ON te.event_id = bo.event_id
        JOIN event_ledger_route er ON er.event_id = te.event_id
        JOIN ledger_route_definition rd ON rd.digest = er.definition_digest
        WHERE rd.binding_digest = ${binding.digest}
          AND (
            (bo.status IN ('PENDING'::blockchain_outbox_status, 'RETRY'::blockchain_outbox_status)
              AND bo.attempt_count < ${maxRetries}
              AND (bo.next_attempt_at IS NULL OR bo.next_attempt_at <= now()))
            OR (bo.status = 'PROCESSING'::blockchain_outbox_status AND bo.lease_expires_at <= now())
          )
          AND NOT EXISTS (
            SELECT 1 FROM delivery_hold h
            WHERE h.resolved_at IS NULL AND h.binding_digest = ${binding.digest}
              AND (h.scope = 'BINDING'
                OR (h.scope = 'EVENT' AND h.event_id = te.event_id)
                OR (h.scope = 'PERMISSION' AND h.permission_ref IN
                  (SELECT permission_ref FROM event_permission_epoch WHERE event_id = te.event_id)))
          )
          AND (
            te.previous_event_hash IS NULL
            OR EXISTS (
              SELECT 1 FROM trace_event pe
              JOIN blockchain_proof pp ON pp.event_id = pe.event_id
              WHERE pe.entity_type = te.entity_type AND pe.entity_id = te.entity_id
                AND pe.data_hash = te.previous_event_hash
                AND pp.transaction_status = 'CONFIRMED'::blockchain_transaction_status
                AND pp.data_hash = pe.data_hash
                AND pp.network = ${binding.network} AND pp.channel_id = ${binding.channelId}
            )
          )
        ORDER BY te.event_time, te.created_at
        LIMIT ${limit}
        FOR UPDATE OF bo SKIP LOCKED
      `);
      if (!rows.length) return [];
      const ids = rows.map((row) => row.id);
      await tx.blockchainOutbox.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'PROCESSING',
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          leaseToken,
          leaseExpiresAt: new Date(Date.now() + leaseMs),
        },
      });
      return tx.blockchainOutbox.findMany({
        where: { id: { in: ids }, leaseToken },
        include: CLAIM_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async deliver(
    job: Claimed,
    binding: Binding,
    connection: BindingConnection,
  ) {
    const event = job.traceEvent;
    try {
      const route = verifiedEventRoute(event);
      const context = event.bindingContext;
      if (
        !route ||
        route.digest !== binding.routeDigest ||
        !context ||
        context.bindingDigest !== binding.digest ||
        !privateTraceEvidenceMatches(event)
      )
        throw new PermanentDeliveryError(
          'Private trace evidence or binding route does not match',
        );
      if (!(await harvestSensorTraceEvidenceMatches(this.prisma, event)))
        throw new PermanentDeliveryError(
          'Sensor trace event does not match its immutable harvest window',
        );

      const credential = await this.prisma.fabricCredentialRevision.findUnique({
        where: {
          bindingDigest_certFingerprint: {
            bindingDigest: binding.digest,
            certFingerprint: connection.fingerprint,
          },
        },
      });
      if (credential?.status !== 'APPROVED') {
        await this.release(
          job,
          60_000,
          'Writer certificate is not an approved credential',
        );
        return;
      }

      const state = await this.reconcile(job, binding, connection);
      if (state !== 'CLEAR') return;
      await this.attempt(job, binding, connection);
    } catch (error) {
      await this.fail(job, error);
    }
  }

  /** Before a new attempt: has an earlier one committed, never will, or is it
   * still unknown? Unknown attempts are fenced on the ledger, not resent. */
  private async reconcile(
    job: Claimed,
    binding: Binding,
    connection: BindingConnection,
  ): Promise<'CLEAR' | 'DONE' | 'WAIT'> {
    const event = job.traceEvent;
    const attempts = await this.prisma.deliveryAttempt.findMany({
      where: { outboxId: job.id },
      include: { outcomes: { orderBy: { sequence: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    const open = attempts.filter(
      (a) => !TERMINAL.includes(a.outcomes[0]?.state ?? 'PREPARED'),
    );
    const proof = await this.readProof(connection, binding, event.id);
    if (proof) {
      this.assertProof(proof, job, binding);
      // Close the unknown attempts truthfully: the committing one is VALID.
      for (const attempt of open)
        await this.outcome(
          attempt.id,
          attempt.txId === proof.txId ? 'VALID' : 'ABANDONED',
          attempt.txId === proof.txId
            ? 'reconciled from the ledger'
            : 'event committed by another attempt',
        );
      await this.complete(job, binding, proof, null);
      return 'DONE';
    }
    if (!open.length) return 'CLEAR';
    const fence = (await connection.client.getDeliveryFence(
      binding.chainRef,
      event.id,
    )) as { generation: string; revision?: number };
    const fenced = Number(fence.generation);
    let unknown = 0;
    for (const attempt of open) {
      const last = attempt.outcomes[0]?.state ?? 'PREPARED';
      if (last === 'PREPARED' || last === 'ENDORSED') {
        // Never submitted to the orderer: nothing can land later.
        await this.outcome(attempt.id, 'ABANDONED', 'never submitted');
        continue;
      }
      const code = await connection.client.transactionValidationCode(
        attempt.txId,
      );
      if (code !== null && code !== 0) {
        await this.outcome(attempt.id, 'INVALID', `validation code ${code}`);
      } else if (code === null && attempt.generation < fenced) {
        // A later fence generation makes this attempt impossible to commit.
        await this.outcome(
          attempt.id,
          'ABANDONED',
          `fenced at generation ${fenced}`,
        );
      } else {
        unknown += 1;
      }
    }
    if (!unknown) return 'CLEAR';
    await this.ensureFence(
      binding,
      event.id,
      event.dataHash,
      fence.revision ?? 0,
    );
    await this.release(job, 15_000, 'Unknown delivery attempt is being fenced');
    return 'WAIT';
  }

  private async ensureFence(
    binding: Binding,
    eventId: string,
    dataHash: string,
    revision: number,
  ) {
    const pending = await this.prisma.ledgerControlJob.findFirst({
      where: {
        eventId,
        operation: 'FENCE_DELIVERY',
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });
    if (!pending)
      await this.prisma.ledgerControlJob.create({
        data: {
          bindingDigest: binding.digest,
          operation: 'FENCE_DELIVERY',
          eventId,
          expectedRevision: revision,
          receipt: { dataHash },
        },
      });
  }

  private async attempt(
    job: Claimed,
    binding: Binding,
    connection: BindingConnection,
  ) {
    const event = job.traceEvent;
    const context = event.bindingContext!;
    const fence = (await connection.client.getDeliveryFence(
      binding.chainRef,
      event.id,
    )) as {
      generation: string;
      dataHash?: string;
    };
    if (fence.dataHash && fence.dataHash !== event.dataHash) {
      await this.prisma.deliveryHold.create({
        data: {
          bindingDigest: binding.digest,
          scope: 'EVENT',
          eventId: event.id,
          reason:
            'Ledger fence pins a different commitment than the stored event',
        },
      });
      await this.release(
        job,
        300_000,
        'Event held: fence pins another commitment',
      );
      return;
    }
    const generation = Number(fence.generation);
    const envelope = {
      envelopeVersion: '4.0.0',
      schemaVersion: '3.0.0',
      canonicalizationVersion: 'RFC8785',
      eventId: event.id,
      nonce: event.id,
      entityType: event.entityType,
      entityId: event.entityId,
      cycleId: event.cycleId,
      lotId: event.lotId,
      eventType: event.eventType,
      eventTime: event.eventTime.toISOString(),
      previousEventHash: event.previousEventHash,
      privateBodyDigest: context.privateBodyDigest,
      bindingDigest: context.bindingDigest,
      chainRef: binding.chainRef,
      permissions: [...context.permissions]
        .sort((a, b) => (a.permissionRef < b.permissionRef ? -1 : 1))
        .map((item) => ({
          permissionRef: item.permissionRef,
          epoch: String(item.epoch),
          ordinal: String(item.ordinal),
        })),
      dataHash: event.dataHash,
    };
    const prepared = connection.client.recordBindingEvent(
      JSON.stringify(envelope),
      JSON.stringify({ generation: String(generation) }),
    );
    // Persist the attempt (txId first) before any network traffic.
    const attempt = await this.prisma.deliveryAttempt.create({
      data: {
        outboxId: job.id,
        bindingDigest: binding.digest,
        leaseToken: job.leaseToken!,
        credentialFingerprint: connection.fingerprint,
        txId: prepared.transactionId,
        generation,
        outcomes: { create: { sequence: 1, state: 'PREPARED' } },
      },
    });
    let sequence = 1;
    const record = async (
      state: Parameters<BindingDeliveryService['outcome']>[1],
      detail?: string,
    ) => this.outcome(attempt.id, state, detail, ++sequence);
    let submitted = false;
    try {
      const endorsed = await prepared.endorse();
      await record('ENDORSED');
      await record('SUBMITTED');
      submitted = true;
      const result = await endorsed.submit();
      if (!result.successful) {
        await record('INVALID', result.status);
        await this.release(
          job,
          this.retryDelay(job.attemptCount),
          `Transaction committed as ${result.status}`,
        );
        return;
      }
      await record('VALID', `block ${result.blockNumber}`);
      const proof = await this.readProof(connection, binding, event.id);
      if (!proof)
        throw new Error('Committed event is not readable on the ledger yet');
      this.assertProof(proof, job, binding);
      await this.complete(job, binding, proof, attempt.id);
    } catch (error) {
      const failure = classifyFabricError(error);
      if (
        failure.kind === 'CHAINCODE' &&
        failure.chaincodeCode === 'DUPLICATE_EVENT'
      ) {
        await record('ABANDONED', 'DUPLICATE_EVENT');
        const proof = await this.readProof(connection, binding, event.id);
        if (!proof)
          throw new Error('Duplicate event is not readable on the ledger');
        this.assertProof(proof, job, binding);
        await this.complete(job, binding, proof, null);
        return;
      }
      if (error instanceof PermanentDeliveryError) {
        await record('ABANDONED', error.message);
        throw error;
      }
      if (failure.unknownOutcome && submitted) {
        await record('UNKNOWN', failure.message.slice(0, 500));
        await this.release(
          job,
          15_000,
          `Unknown outcome: ${failure.message.slice(0, 200)}`,
        );
        return;
      }
      await record('ABANDONED', failure.chaincodeCode ?? failure.kind);
      if (
        failure.kind === 'CHAINCODE' &&
        PERMANENT_CODES.has(failure.chaincodeCode ?? '')
      )
        throw new PermanentDeliveryError(
          `${failure.chaincodeCode}: ${failure.message}`,
        );
      const wait =
        failure.kind === 'CHAINCODE' &&
        WAIT_CODES.has(failure.chaincodeCode ?? '');
      await this.release(
        job,
        wait ? 60_000 : this.retryDelay(job.attemptCount),
        `${failure.chaincodeCode ?? failure.kind}: ${failure.message}`.slice(
          0,
          500,
        ),
      );
    }
  }

  private async readProof(
    connection: BindingConnection,
    binding: Binding,
    eventId: string,
  ): Promise<LedgerProof | null> {
    try {
      return (await connection.client.getBindingProof(
        binding.chainRef,
        eventId,
      )) as LedgerProof;
    } catch (error) {
      if (
        /NOT_FOUND|does not exist/i.test(
          String((error as Error).message) +
            JSON.stringify((error as { details?: unknown }).details ?? ''),
        )
      )
        return null;
      throw error;
    }
  }

  /** The committed proof must equal the complete public tuple we sent. */
  private assertProof(proof: LedgerProof, job: Claimed, binding: Binding) {
    const event = job.traceEvent;
    const context = event.bindingContext!;
    const expected = {
      eventId: event.id,
      chainRef: binding.chainRef,
      bindingDigest: context.bindingDigest,
      entityType: event.entityType,
      entityId: event.entityId,
      eventType: event.eventType,
      eventTime: event.eventTime.toISOString(),
      dataHash: event.dataHash,
      previousEventHash: event.previousEventHash ?? null,
      privateBodyDigest: context.privateBodyDigest,
    };
    const mismatch = Object.entries(expected).find(
      ([key, value]) =>
        (proof as unknown as Record<string, unknown>)[key] !== value,
    );
    const permissions = [...context.permissions]
      .sort((a, b) => (a.permissionRef < b.permissionRef ? -1 : 1))
      .map((item) => `${item.permissionRef}:${item.epoch}:${item.ordinal}`)
      .join(',');
    const ledgerPermissions = proof.permissions
      .map((item) => `${item.permissionRef}:${item.epoch}:${item.ordinal}`)
      .join(',');
    if (
      mismatch ||
      permissions !== ledgerPermissions ||
      proof.channelId !== binding.channelId ||
      !/^[a-f0-9]{64}$/.test(proof.txId) ||
      !Number.isFinite(new Date(proof.recordedAt).getTime())
    )
      throw new PermanentDeliveryError(
        `Fabric committed proof does not match the public event tuple${mismatch ? ` (${mismatch[0]})` : ''}`,
      );
  }

  private async complete(
    job: Claimed,
    binding: Binding,
    proof: LedgerProof,
    attemptId: string | null,
  ) {
    const recordedAt = new Date(proof.recordedAt);
    await this.prisma.$transaction(async (tx) => {
      const done = await tx.blockchainOutbox.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
        data: {
          status: 'COMPLETED',
          completedAt: recordedAt,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          lastError: null,
        },
      });
      if (done.count !== 1) {
        this.logger.warn(`Ignored stale completion eventId=${job.eventId}`);
        return;
      }
      const data = {
        network: binding.network,
        channelId: binding.channelId,
        txId: proof.txId,
        dataHash: job.traceEvent.dataHash,
        recordedAt,
        transactionStatus: 'CONFIRMED' as const,
        attemptCount: job.attemptCount,
        nextAttemptAt: null,
        lastError: null,
      };
      await tx.blockchainProof.upsert({
        where: { eventId: job.eventId },
        create: { eventId: job.eventId, ...data },
        update: data,
      });
    });
    void attemptId;
    this.logger.log(
      `B event confirmed eventId=${job.eventId} tx=${proof.txId.slice(0, 12)}`,
    );
  }

  private async outcome(
    attemptId: string,
    state:
      | 'PREPARED'
      | 'ENDORSED'
      | 'SUBMITTED'
      | 'VALID'
      | 'INVALID'
      | 'UNKNOWN'
      | 'ABANDONED',
    detail?: string,
    sequence?: number,
  ) {
    const next =
      sequence ??
      ((
        await this.prisma.deliveryAttemptOutcome.aggregate({
          where: { attemptId },
          _max: { sequence: true },
        })
      )._max.sequence ?? 0) + 1;
    await this.prisma.deliveryAttemptOutcome.create({
      data: {
        attemptId,
        sequence: next,
        state,
        detail: detail?.slice(0, 1000),
      },
    });
  }

  private async release(job: Claimed, delayMs: number, reason: string) {
    // Waiting on governance, an outage or an unknown outcome must not spend
    // the retry budget: give the claim's increment back.
    await this.prisma.blockchainOutbox.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
      data: {
        status: 'RETRY',
        attemptCount: { decrement: 1 },
        nextAttemptAt: new Date(Date.now() + delayMs),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: reason.slice(0, 2000),
      },
    });
  }

  private async fail(job: Claimed, error: unknown) {
    const message = (
      error instanceof Error ? error.message : 'Unknown delivery error'
    ).slice(0, 2000);
    const maxRetries = this.number('FABRIC_MAX_RETRIES', 5);
    const terminal =
      error instanceof PermanentDeliveryError || job.attemptCount >= maxRetries;
    await this.prisma.blockchainOutbox.updateMany({
      where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
      data: {
        status: terminal ? 'DEAD_LETTER' : 'RETRY',
        nextAttemptAt: terminal
          ? null
          : new Date(Date.now() + this.retryDelay(job.attemptCount)),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
      },
    });
    (terminal ? this.logger.error : this.logger.warn).call(
      this.logger,
      `B delivery ${terminal ? 'dead-lettered' : 'will retry'} eventId=${job.eventId}: ${message}`,
    );
  }

  private retryDelay(attempt: number): number {
    return Math.round(
      Math.min(300_000, 2 ** attempt * 1000) * (0.8 + Math.random() * 0.4),
    );
  }

  private number(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
}
