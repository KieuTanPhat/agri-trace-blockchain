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
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from '../trace/trace-hash.js';

type FabricReceipt = {
  txId?: string;
  recordedAt?: string;
  channelId?: string;
  dataHash?: string;
};

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
      const proofs = await this.prisma.blockchainProof.findMany({
        where: {
          transactionStatus: { in: ['PENDING', 'FAILED'] },
          attemptCount: { lt: Number(process.env.FABRIC_MAX_RETRIES ?? 5) },
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }],
        },
        include: { traceEvent: true },
        orderBy: { createdAt: 'asc' },
        take: limit,
      });
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

  private async submit(
    proof: Awaited<
      ReturnType<PrismaService['blockchainProof']['findFirstOrThrow']>
    > & { traceEvent: Record<string, any> },
  ) {
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
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          lastError: null,
        },
      });
    } catch (error) {
      const attempt = proof.attemptCount + 1;
      const retryMs = Math.min(300_000, 2 ** attempt * 1_000);
      await this.prisma.blockchainProof.update({
        where: { id: proof.id },
        data: {
          transactionStatus: 'FAILED',
          attemptCount: attempt,
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
