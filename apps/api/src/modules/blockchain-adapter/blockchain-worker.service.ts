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
  assertPinnedLedgerRoute,
  EVENT_LEDGER_ROUTE_INCLUDE,
  ledgerRouteDigest,
  ledgerRoutePins,
  verifiedEventRoute,
  type RouteDefinition,
} from '../trace/ledger-route.js';
import {
  routeImportPins,
  verifiedRouteImportArtifact,
} from '../trace/ledger-route-import-artifact.js';

function importProvenanceFilter(
  routeAlias: 'er' | 'previous_route',
  eventAlias: 'te' | 'previous_event',
  imports: string[],
) {
  const column = Prisma.raw(`${routeAlias}.import_digest`);
  if (!imports.length) return Prisma.sql`${column} IS NULL`;
  return Prisma.sql`(${column} IS NULL OR (
    ${column} IN (${Prisma.join(imports)}) AND EXISTS (
      SELECT 1 FROM ledger_route_import ri, jsonb_array_elements(ri.artifact->'entries') imported_entry
      WHERE ri.digest=${column}
        AND imported_entry->>'eventId'=${Prisma.raw(`${eventAlias}.event_id`)}::text
        AND imported_entry->>'dataHash'=${Prisma.raw(`${eventAlias}.data_hash`)}
        AND imported_entry->>'definitionDigest'=${Prisma.raw(`${routeAlias}.definition_digest`)}
    )
  ))`;
}

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
      const pins = ledgerRoutePins();
      const writer = this.fabric.getWriterRoute();
      const definitions = await this.prisma.ledgerRouteDefinition.findMany({
        where: { digest: { in: [...pins] } },
      });
      const trusted = definitions.filter((route) => {
        try {
          assertPinnedLedgerRoute(route, pins);
          return true;
        } catch {
          return false;
        }
      });
      const eligible = trusted
        .filter((route) => this.matchesWriter(route, writer))
        .map((route) => route.digest);
      if (!eligible.length) return { processed: 0, skipped: false };
      const importPins = routeImportPins();
      const imports = importPins.length
        ? await this.prisma.ledgerRouteImport.findMany({
            where: { digest: { in: importPins.map((pin) => pin.digest) } },
          })
        : [];
      const trustedImports = imports
        .filter((record) => {
          try {
            verifiedRouteImportArtifact(record, importPins);
            return true;
          } catch {
            return false;
          }
        })
        .map((record) => record.digest);
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
      const jobs = await this.claimPending(
        limit,
        eligible,
        trusted.map((route) => route.digest),
        trustedImports,
      );
      for (const job of jobs) {
        await this.submit(job);
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  private matchesWriter(
    route: RouteDefinition,
    writer: RouteDefinition,
  ): boolean {
    return (
      route.mode === 'WRITE' &&
      ledgerRouteDigest(route) === ledgerRouteDigest(writer)
    );
  }

  private async claimPending(
    limit: number,
    eligible: string[],
    trusted: string[],
    imports: string[],
  ): Promise<ClaimedOutbox[]> {
    const maxRetries = this.numberConfig('FABRIC_MAX_RETRIES', 5);
    const leaseMs = this.numberConfig('FABRIC_CLAIM_LEASE_MS', 120_000);
    const leaseToken = randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bo.outbox_id AS id
        FROM blockchain_outbox bo
        JOIN trace_event te ON te.event_id = bo.event_id
        JOIN event_ledger_route er ON er.event_id = te.event_id
        JOIN ledger_route_definition rd ON rd.digest = er.definition_digest
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
          AND er.definition_digest IN (${Prisma.join(eligible)})
          AND ${importProvenanceFilter('er', 'te', imports)}
          AND (
            te.previous_event_hash IS NULL
            OR EXISTS (
              SELECT 1
              FROM trace_event previous_event
              LEFT JOIN blockchain_outbox previous_outbox
                ON previous_outbox.event_id = previous_event.event_id
              LEFT JOIN blockchain_proof previous_proof
                ON previous_proof.event_id = previous_event.event_id
              JOIN event_ledger_route previous_route ON previous_route.event_id = previous_event.event_id
              JOIN ledger_route_definition previous_definition ON previous_definition.digest = previous_route.definition_digest
              WHERE previous_event.entity_type = te.entity_type
                AND previous_event.entity_id = te.entity_id
                AND previous_event.data_hash = te.previous_event_hash
                AND previous_route.definition_digest IN (${Prisma.join(trusted)})
                AND ${importProvenanceFilter('previous_route', 'previous_event', imports)}
                AND (previous_definition.network, previous_definition.channel_id, previous_definition.chaincode_name, previous_definition.contract_name)
                  = (rd.network, rd.channel_id, rd.chaincode_name, rd.contract_name)
                AND previous_proof.transaction_status = 'CONFIRMED'::blockchain_transaction_status
                AND previous_proof.data_hash = previous_event.data_hash
                AND previous_proof.network = previous_definition.network
                AND previous_proof.channel_id = previous_definition.channel_id
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
        include: {
          traceEvent: {
            include: {
              ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
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
    const route = verifiedEventRoute(event);
    if (!route || !this.matchesWriter(route, this.fabric.getWriterRoute())) {
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
      const channelId = route.channelId;
      if (receipt.channelId !== channelId)
        throw new PermanentBlockchainError(
          'Fabric proof belongs to a different channel',
        );
      const network = route.network;
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
