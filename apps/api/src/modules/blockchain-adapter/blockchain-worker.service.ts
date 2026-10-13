import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type TraceEventEnvelope } from '@agri-trace/fabric-gateway';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FabricAdapterProvider } from './fabric-adapter.provider.js';
import { privateTraceEvidenceMatches } from '../trace/trace-evidence.js';
import { harvestSensorTraceEvidenceMatches } from '../iot/harvest-sensor-evidence.js';
import {
  EVENT_BINDING_CONTEXT_INCLUDE,
  EVENT_LEDGER_ROUTE_INCLUDE,
  verifiedEventRoute,
  type PinnedRoute,
} from '../trace/ledger-route.js';

type FabricReceipt = {
  txId?: string;
  recordedAt?: string;
  channelId?: string;
  dataHash?: string;
  eventId?: string;
  envelopeVersion?: string;
  nonce?: string;
  entityType?: string;
  entityId?: string;
  cycleId?: string;
  lotId?: string;
  eventType?: string;
  eventTime?: string;
  previousEventHash?: string;
  schemaVersion?: string;
  canonicalizationVersion?: string;
};

type ClaimedOutbox = Prisma.BlockchainOutboxGetPayload<{
  include: {
    traceEvent: {
      include: {
        ledgerRoute: typeof EVENT_LEDGER_ROUTE_INCLUDE;
        bindingContext: typeof EVENT_BINDING_CONTEXT_INCLUDE;
        ledgerRouteExemption: true;
        blockchainProof: true;
      };
    };
  };
}>;

@Injectable()
export class BlockchainWorkerService {
  private readonly logger = new Logger(BlockchainWorkerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly fabric: FabricAdapterProvider,
  ) {}

  async processPending(
    limit = this.numberConfig('FABRIC_WORKER_BATCH_SIZE', 20),
  ) {
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      const writer = this.fabric.getWriterRoute();
      // Capability/network failures must not consume leases or retry budgets.
      const adapter = await this.fabric.getAdapter();
      const health = (await adapter.healthCheck()) as {
        status?: string;
        envelopeVersion?: string;
      };
      if (health.status !== 'OK' || health.envelopeVersion !== '3.0.0')
        throw new Error(
          'Fabric writer paused: incompatible chaincode envelope',
        );
      const jobs = await this.claimPending(limit, writer);
      for (const job of jobs) {
        await this.submit(job);
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  private async claimPending(
    limit: number,
    writer: PinnedRoute,
  ): Promise<ClaimedOutbox[]> {
    const maxRetries = this.numberConfig('FABRIC_MAX_RETRIES', 5);
    const leaseMs = this.numberConfig('FABRIC_CLAIM_LEASE_MS', 120_000);
    const leaseToken = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bo.outbox_id AS id
        FROM blockchain_outbox bo
        JOIN trace_event te ON te.event_id = bo.event_id
        LEFT JOIN event_ledger_route er ON er.event_id = te.event_id
        WHERE (
          (
            bo.status IN (
              'PENDING'::blockchain_outbox_status,
              'RETRY'::blockchain_outbox_status
            )
            AND bo.attempt_count < ${maxRetries}
            AND (bo.next_attempt_at IS NULL OR bo.next_attempt_at <= now())
          )
          OR (
            bo.status = 'PROCESSING'::blockchain_outbox_status
            AND bo.lease_expires_at <= now()
          )
        )
          -- Only events routed to this writer, or sealed pre-route history
          -- (which was always delivered by the configured legacy writer).
          AND (
            er.definition_digest = ${writer.digest}
            OR (er.event_id IS NULL AND EXISTS (
              SELECT 1 FROM ledger_route_exemption ex WHERE ex.event_id = te.event_id
            ))
          )
          AND (
            te.previous_event_hash IS NULL
            OR EXISTS (
              SELECT 1
              FROM trace_event previous_event
              JOIN blockchain_proof previous_proof
                ON previous_proof.event_id = previous_event.event_id
              WHERE previous_event.entity_type = te.entity_type
                AND previous_event.entity_id = te.entity_id
                AND previous_event.data_hash = te.previous_event_hash
                AND previous_proof.transaction_status = 'CONFIRMED'::blockchain_transaction_status
                AND previous_proof.data_hash = previous_event.data_hash
                AND previous_proof.network = ${writer.network}
                AND previous_proof.channel_id = ${writer.channelId}
            )
          )
        ORDER BY te.event_time, te.created_at
        LIMIT ${limit}
        FOR UPDATE OF bo SKIP LOCKED
      `);
      if (rows.length === 0) return [];

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
        include: {
          traceEvent: {
            include: {
              ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
              bindingContext: EVENT_BINDING_CONTEXT_INCLUDE,
              ledgerRouteExemption: true,
              blockchainProof: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async submit(job: ClaimedOutbox): Promise<void> {
    const event = job.traceEvent;
    const writer = this.fabric.getWriterRoute();
    const route = event.ledgerRoute ? verifiedEventRoute(event) : null;
    const deliverable = event.ledgerRoute
      ? route?.digest === writer.digest
      : Boolean(event.ledgerRouteExemption);
    if (!deliverable) {
      await this.prisma.blockchainOutbox.updateMany({
        where: { id: job.id, status: 'PROCESSING', leaseToken: job.leaseToken },
        data: {
          status: 'PENDING',
          attemptCount: { decrement: 1 },
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 60000),
          lastError: 'Ledger route is unverified or has no compatible writer',
        },
      });
      return;
    }
    try {
      if (
        event.schemaVersion !== '2.0.0' ||
        event.canonicalizationVersion !== 'RFC8785'
      ) {
        throw new PermanentBlockchainError(
          `Unsupported trace contract version ${event.schemaVersion}/${event.canonicalizationVersion}`,
        );
      }
      if (!privateTraceEvidenceMatches(event)) {
        throw new PermanentBlockchainError(
          'Private trace evidence is missing or its hash does not match',
        );
      }
      const adapter = await this.fabric.getAdapter();
      if (!(await harvestSensorTraceEvidenceMatches(this.prisma, event)))
        throw new PermanentBlockchainError(
          'Sensor trace event does not match its immutable harvest window',
        );
      const input: TraceEventEnvelope = {
        eventId: event.id,
        nonce: event.id,
        envelopeVersion: '3.0.0',
        entityType: event.entityType as TraceEventEnvelope['entityType'],
        entityId: event.entityId,
        cycleId: event.cycleId ?? undefined,
        lotId: event.lotId ?? undefined,
        eventType: event.eventType,
        eventTime: event.eventTime.toISOString(),
        dataHash: event.dataHash,
        previousEventHash: event.previousEventHash ?? undefined,
        schemaVersion: '2.0.0',
        canonicalizationVersion: 'RFC8785',
      };

      let submitted: FabricReceipt | undefined;
      try {
        // Fabric Gateway submitTransaction returns only after a VALID commit.
        submitted = (await adapter.submitTraceEvent(input)) as FabricReceipt;
        if (!submitted?.txId)
          throw new Error('Fabric commit receipt is missing transaction id');
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/\bDUPLICATE_EVENT:/.test(error.message)
        ) {
          throw error;
        }
      }
      // A proof queried from committed ledger state is required for both a new
      // submission and recovery of an already committed event (including v2).
      const receipt = (await adapter.getProof(event.id)) as FabricReceipt;
      const fields = [
        'eventId',
        'entityType',
        'entityId',
        'cycleId',
        'lotId',
        'eventType',
        'eventTime',
        'dataHash',
        'previousEventHash',
        'schemaVersion',
        'canonicalizationVersion',
      ] as const;
      if (
        !receipt ||
        fields.some(
          (field) => (receipt[field] ?? null) !== (input[field] ?? null),
        ) ||
        (receipt.envelopeVersion !== undefined &&
          (receipt.envelopeVersion !== input.envelopeVersion ||
            receipt.nonce !== input.nonce)) ||
        (receipt.envelopeVersion === undefined &&
          receipt.nonce !== undefined) ||
        (submitted &&
          (submitted.txId !== receipt.txId ||
            submitted.dataHash !== receipt.dataHash ||
            submitted.eventId !== receipt.eventId))
      )
        throw new PermanentBlockchainError(
          'Fabric committed proof does not match the complete public event tuple',
        );

      if (!receipt.txId || !/^[a-f0-9]{64}$/.test(receipt.txId)) {
        throw new PermanentBlockchainError(
          'Fabric receipt has a missing or invalid transaction id',
        );
      }
      if (!receipt.dataHash) {
        throw new Error('Fabric receipt is missing data hash');
      }
      if (receipt.dataHash !== event.dataHash) {
        throw new PermanentBlockchainError(
          'Fabric receipt hash does not match the trace event',
        );
      }

      const recordedAt = new Date(receipt.recordedAt ?? '');
      if (!Number.isFinite(recordedAt.getTime())) {
        throw new PermanentBlockchainError(
          'Fabric receipt has an invalid recording time',
        );
      }
      const channelId = writer.channelId;
      if (receipt.channelId !== channelId)
        throw new PermanentBlockchainError(
          'Fabric proof belongs to a different channel',
        );
      const network = writer.network;
      const existing = event.blockchainProof;
      if (
        existing?.transactionStatus === 'CONFIRMED' &&
        (existing.network !== network ||
          existing.channelId !== channelId ||
          existing.dataHash !== event.dataHash ||
          existing.txId !== receipt.txId ||
          existing.recordedAt?.getTime() !== recordedAt.getTime())
      )
        throw new PermanentBlockchainError(
          'Committed proof conflicts with the immutable route/receipt',
        );

      await this.prisma.$transaction(async (tx) => {
        const completion = await tx.blockchainOutbox.updateMany({
          where: {
            id: job.id,
            status: 'PROCESSING',
            leaseToken: job.leaseToken,
          },
          data: {
            status: 'COMPLETED',
            completedAt: recordedAt,
            leaseToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            lastError: null,
          },
        });
        if (completion.count !== 1) {
          this.logger.warn(
            `Ignored stale completion eventId=${event.id} outboxId=${job.id}`,
          );
          return;
        }

        await tx.blockchainProof.upsert({
          where: { eventId: event.id },
          create: {
            eventId: event.id,
            network,
            channelId,
            txId: receipt.txId,
            dataHash: event.dataHash,
            recordedAt,
            transactionStatus: 'CONFIRMED',
            attemptCount: job.attemptCount,
          },
          update: {
            network,
            channelId,
            txId: receipt.txId,
            dataHash: event.dataHash,
            recordedAt,
            transactionStatus: 'CONFIRMED',
            attemptCount: job.attemptCount,
            nextAttemptAt: null,
            lastError: null,
          },
        });
      });

      this.logger.log('Fabric event confirmed', {
        eventId: event.id,
        outboxId: job.id,
        attempt: job.attemptCount,
        txId: receipt.txId,
      });
    } catch (error) {
      await this.recordFailure(job, error);
    }
  }

  private async recordFailure(
    job: ClaimedOutbox,
    error: unknown,
  ): Promise<void> {
    const maxRetries = this.numberConfig('FABRIC_MAX_RETRIES', 5);
    const message = (
      error instanceof Error ? error.message : 'Unknown Fabric error'
    ).slice(0, 2000);
    const terminal =
      error instanceof PermanentBlockchainError ||
      /\b(HASH_CHAIN_CONFLICT|DUPLICATE_EVENT_CONFLICT|INVALID_INPUT|UNAUTHORIZED_RELAYER):/.test(
        message,
      ) ||
      job.attemptCount >= maxRetries;
    const retryMs = this.retryDelay(job.attemptCount);

    const update = await this.prisma.blockchainOutbox.updateMany({
      where: {
        id: job.id,
        status: 'PROCESSING',
        leaseToken: job.leaseToken,
      },
      data: {
        status: terminal ? 'DEAD_LETTER' : 'RETRY',
        nextAttemptAt: terminal ? null : new Date(Date.now() + retryMs),
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: message,
      },
    });

    if (update.count === 1) {
      const level = terminal ? 'error' : 'warn';
      this.logger[level]('Fabric submit failed', {
        eventId: job.eventId,
        outboxId: job.id,
        attempt: job.attemptCount,
        terminal,
      });
    }
  }

  private retryDelay(attempt: number): number {
    const maximum = this.numberConfig('FABRIC_MAX_RETRY_DELAY_MS', 300_000);
    const base = Math.min(maximum, 2 ** attempt * 1_000);
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  private numberConfig(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.floor(value);
  }
}

class PermanentBlockchainError extends Error {}
