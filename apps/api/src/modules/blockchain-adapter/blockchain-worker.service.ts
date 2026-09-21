import {
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  FabricBlockchainAdapter,
  connectGateway,
  loadConfig,
  type GatewayConnection,
  type TraceEventInput,
} from '@agri-trace/fabric-gateway';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from '../trace/trace-hash.js';

type FabricReceipt = {
  txId?: string;
  recordedAt?: string;
  channelId?: string;
  dataHash?: string;
};

type ClaimedProof = Prisma.BlockchainProofGetPayload<{
  include: { traceEvent: true };
}>;

@Injectable()
export class BlockchainWorkerService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(BlockchainWorkerService.name);
  private timer?: NodeJS.Timeout;
  private connection?: GatewayConnection;
  private adapter?: FabricBlockchainAdapter;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    if (process.env.FABRIC_ENABLED !== 'true') return;
    const interval = Number(process.env.FABRIC_WORKER_INTERVAL_MS ?? 10_000);
    this.timer = setInterval(() => void this.processPending(), interval);
    this.timer.unref();
    void this.processPending();
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.connection?.close();
  }

  async processPending(limit = 20) {
    if (this.running) return { processed: 0, skipped: true };
    this.running = true;
    let processed = 0;
    try {
      const proofs = await this.claimPending(limit);
      for (const proof of proofs) {
        await this.submit(proof);
        processed += 1;
      }
      return { processed, skipped: false };
    } finally {
      this.running = false;
    }
  }

  async verify(eventId: string) {
    const proof = await this.prisma.blockchainProof.findUnique({
      where: { eventId },
      include: { traceEvent: true },
    });
    if (!proof) throw new NotFoundException('Không tìm thấy blockchain proof');
    const result: Record<string, unknown> = {
      eventId,
      status: proof.transactionStatus,
      dataHash: proof.dataHash,
      localHashMatches:
        proof.dataHash === proof.traceEvent.dataHash &&
        proof.dataHash === calculateTraceEventHash(proof.traceEvent),
      txId: proof.txId,
      channelId: proof.channelId,
    };
    if (
      proof.transactionStatus === 'CONFIRMED' &&
      process.env.FABRIC_ENABLED === 'true'
    ) {
      try {
        const chainHash = await (
          await this.getAdapter()
        ).getExpectedHash(eventId);
        result.chainHash = chainHash;
        result.blockchainHashMatches = chainHash === proof.dataHash;
      } catch (error) {
        result.blockchainCheckError =
          error instanceof Error ? error.message : 'Blockchain query failed';
      }
    }
    return result;
  }

  private async claimPending(limit: number): Promise<ClaimedProof[]> {
    const maxRetries = Number(process.env.FABRIC_MAX_RETRIES ?? 5);
    const leaseMs = Number(process.env.FABRIC_CLAIM_LEASE_MS ?? 120_000);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT bp.proof_id AS id
        FROM blockchain_proof bp
        JOIN trace_event te ON te.event_id = bp.event_id
        WHERE bp.transaction_status IN (
          'PENDING'::blockchain_transaction_status,
          'FAILED'::blockchain_transaction_status
        )
          AND bp.attempt_count < ${maxRetries}
          AND (bp.next_attempt_at IS NULL OR bp.next_attempt_at <= now())
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
                AND previous_proof.transaction_status =
                  'CONFIRMED'::blockchain_transaction_status
            )
          )
        ORDER BY te.event_time, te.created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `);
      if (rows.length === 0) return [];
      const ids = rows.map((row) => row.id);
      await tx.blockchainProof.updateMany({
        where: { id: { in: ids } },
        data: {
          attemptCount: { increment: 1 },
          nextAttemptAt: new Date(Date.now() + leaseMs),
        },
      });
      return tx.blockchainProof.findMany({
        where: { id: { in: ids } },
        include: { traceEvent: true },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  private async submit(proof: ClaimedProof) {
    const event = proof.traceEvent;
    try {
      const adapter = await this.getAdapter();
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
        )
          throw error;
        receipt = (await adapter.getProof(event.id)) as FabricReceipt;
        if (receipt.dataHash !== event.dataHash)
          throw new Error('Duplicate event exists with a different hash');
      }
      await this.prisma.blockchainProof.update({
        where: { id: proof.id },
        data: {
          transactionStatus: 'CONFIRMED',
          txId: receipt.txId,
          channelId:
            receipt.channelId ?? process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
          recordedAt: receipt.recordedAt
            ? new Date(receipt.recordedAt)
            : new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempt = proof.attemptCount;
      const retryMs = Math.min(300_000, 2 ** attempt * 1_000);
      await this.prisma.blockchainProof.update({
        where: { id: proof.id },
        data: {
          transactionStatus: 'FAILED',
          nextAttemptAt: new Date(Date.now() + retryMs),
          lastError: (error instanceof Error
            ? error.message
            : 'Unknown Fabric error'
          ).slice(0, 2000),
        },
      });
      this.logger.error(`Fabric submit failed for ${event.id}`);
    }
  }

  private async getAdapter() {
    if (this.adapter) return this.adapter;
    const config = loadConfig();
    this.connection = await connectGateway(config);
    this.adapter = new FabricBlockchainAdapter(this.connection.gateway, config);
    return this.adapter;
  }
}
