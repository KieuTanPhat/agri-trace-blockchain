import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type TraceEventInput,
} from '@agri-trace/fabric-gateway';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { FabricAdapterProvider } from './fabric-adapter.provider.js';

type FabricReceipt = {
  txId?: string;
  recordedAt?: string;
  channelId?: string;
  dataHash?: string;
};

type ClaimedOutbox = Prisma.BlockchainOutboxGetPayload<{
  include: { traceEvent: true };
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

  async processPending(limit = this.numberConfig('FABRIC_WORKER_BATCH_SIZE', 20)) {
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      const jobs = await this.claimPending(limit);
      for (const job of jobs) {
        await this.submit(job);
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  private async claimPending(limit: number): Promise<ClaimedOutbox[]> {
    const maxRetries = this.numberConfig('FABRIC_MAX_RETRIES', 5);
    const leaseMs = this.numberConfig('FABRIC_CLAIM_LEASE_MS', 120_000);
    const leaseToken = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bo.outbox_id AS id
        FROM blockchain_outbox bo
        JOIN trace_event te ON te.event_id = bo.event_id
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
          AND (
            te.previous_event_hash IS NULL
            OR EXISTS (
              SELECT 1
              FROM trace_event previous_event
              LEFT JOIN blockchain_outbox previous_outbox
                ON previous_outbox.event_id = previous_event.event_id
              LEFT JOIN blockchain_proof previous_proof
                ON previous_proof.event_id = previous_event.event_id
              WHERE previous_event.entity_type = te.entity_type
                AND previous_event.entity_id = te.entity_id
                AND previous_event.data_hash = te.previous_event_hash
                AND (
                  previous_outbox.status = 'COMPLETED'::blockchain_outbox_status
                  OR previous_proof.transaction_status =
                    'CONFIRMED'::blockchain_transaction_status
                )
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
        include: { traceEvent: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async submit(job: ClaimedOutbox): Promise<void> {
    const event = job.traceEvent;
    try {
      if (
        event.schemaVersion !== '2.0.0' ||
        event.canonicalizationVersion !== 'RFC8785'
      ) {
        throw new PermanentBlockchainError(
          `Unsupported trace contract version ${event.schemaVersion}/${event.canonicalizationVersion}`,
        );
      }
      const adapter = await this.fabric.getAdapter();
      const input: TraceEventInput = {
        eventId: event.id,
        entityType: event.entityType as TraceEventInput['entityType'],
        entityId: event.entityId,
        cycleId: event.cycleId ?? undefined,
        lotId: event.lotId ?? undefined,
        eventType: event.eventType,
        eventTime: event.eventTime.toISOString(),
        dataHash: event.dataHash,
        previousEventHash: event.previousEventHash ?? undefined,
        schemaVersion: '2.0.0',
        canonicalizationVersion: 'RFC8785',
        actorContext: {
          actorUserId: event.actorUserId ?? undefined,
          organizationId: event.actorOrganizationId ?? undefined,
          role: event.actorRole,
          authProofType: (event.authProofType ??
            'SYSTEM_ASSERTION') as TraceEventInput['actorContext']['authProofType'],
          actorAuthProof: event.actorAuthProof ?? event.dataHash,
        },
        payloadMetadata: { hasBusinessPayload: true },
      };

      let receipt: FabricReceipt;
      try {
        receipt = (await adapter.submitTraceEvent(input)) as FabricReceipt;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes('DUPLICATE_EVENT')
        ) {
          throw error;
        }
        receipt = (await adapter.getProof(event.id)) as FabricReceipt;
        if (receipt.dataHash !== event.dataHash) {
          throw new PermanentBlockchainError(
            'Duplicate event exists with a different hash',
          );
        }
      }

      if (!receipt.txId) {
        throw new Error('Fabric receipt is missing transaction id');
      }

      const recordedAt = receipt.recordedAt
        ? new Date(receipt.recordedAt)
        : new Date();
      const channelId =
        receipt.channelId ??
        this.config.get<string>('FABRIC_CHANNEL_NAME', 'agritrace');
      const network = this.config.get<string>(
        'FABRIC_NETWORK_NAME',
        'hyperledger-fabric',
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
    const message = (error instanceof Error
      ? error.message
      : 'Unknown Fabric error'
    ).slice(0, 2000);
    const terminal =
      error instanceof PermanentBlockchainError || job.attemptCount >= maxRetries;
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
