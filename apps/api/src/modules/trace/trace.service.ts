import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from './trace-hash.js';

export type Actor = {
  sub: string | null;
  organizationId: string | null;
  role: string;
};

export interface CreateTraceEventInput {
  entityType: string;
  entityId: string;
  eventType: string;
  actor: Actor;
  cycleId?: string;
  lotId?: string;
  eventTime?: Date;
  businessData: Prisma.InputJsonValue;
}

@Injectable()
export class TraceService {
  constructor(private readonly prisma: PrismaService) {}

  async createInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateTraceEventInput,
  ) {
    // Serialize hash-chain head creation per entity. Without this transaction
    // lock, two concurrent commands can both read the same predecessor and
    // produce sibling events that Fabric cannot append deterministically.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.entityType}:${input.entityId}`}, 0))`,
    );
    const id = randomUUID();
    const eventTime = input.eventTime ?? new Date();
    const previous = await tx.traceEvent.findFirst({
      where: { entityType: input.entityType, entityId: input.entityId },
      orderBy: [{ eventTime: 'desc' }, { createdAt: 'desc' }],
      select: { dataHash: true },
    });
    const actorAuthProof = createHash('sha256')
      .update(`${input.actor.sub}:${input.actor.role}`, 'utf8')
      .digest('hex');
    const authProofType = input.actor.sub
      ? 'TOKEN_FINGERPRINT'
      : 'SYSTEM_ASSERTION';
    const dataHash = calculateTraceEventHash({
      id,
      entityType: input.entityType,
      entityId: input.entityId,
      cycleId: input.cycleId ?? null,
      lotId: input.lotId ?? null,
      eventType: input.eventType,
      eventTime,
      actorUserId: input.actor.sub,
      actorOrganizationId: input.actor.organizationId,
      actorRole: input.actor.role,
      authProofType,
      actorAuthProof,
      businessData: input.businessData,
      previousEventHash: previous?.dataHash ?? null,
      schemaVersion: '2.0.0',
      canonicalizationVersion: 'RFC8785',
    });

    const event = await tx.traceEvent.create({
      data: {
        id,
        entityType: input.entityType,
        entityId: input.entityId,
        cycleId: input.cycleId,
        lotId: input.lotId,
        eventType: input.eventType,
        actorUserId: input.actor.sub ?? undefined,
        actorOrganizationId: input.actor.organizationId,
        actorRole: input.actor.role,
        authProofType,
        actorAuthProof,
        eventTime,
        businessData: input.businessData,
        dataHash,
        previousEventHash: previous?.dataHash,
      },
    });

    await tx.blockchainOutbox.create({
      data: {
        eventId: event.id,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
    return event;
  }

  async getLotHistory(lotId: string) {
    const lot = await this.prisma.lot.findUnique({ where: { id: lotId } });
    if (!lot) throw new NotFoundException('Không tìm thấy lô hàng');
    return this.prisma.traceEvent.findMany({
      where: { lotId },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: { blockchainProof: true, blockchainOutbox: true },
    });
  }

  async getProof(eventId: string) {
    const event = await this.prisma.traceEvent.findUnique({
      where: { id: eventId },
      include: { blockchainProof: true, blockchainOutbox: true },
    });
    if (!event) throw new NotFoundException('Không tìm thấy trace event');
    const proof = event.blockchainProof;
    return {
      eventId,
      network:
        proof?.network ??
        process.env.FABRIC_NETWORK_NAME ??
        'hyperledger-fabric',
      channelId:
        proof?.channelId ?? process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
      txId: proof?.txId ?? null,
      dataHash: proof?.dataHash ?? event.dataHash,
      recordedAt: proof?.recordedAt ?? null,
      transactionStatus: proof
        ? proof.transactionStatus
        : event.blockchainOutbox?.status === 'DEAD_LETTER'
          ? 'FAILED'
          : 'PENDING',
      attemptCount: event.blockchainOutbox?.attemptCount ?? 0,
      nextAttemptAt: event.blockchainOutbox?.nextAttemptAt ?? null,
      lastError: event.blockchainOutbox?.lastError ?? null,
      localHashMatches:
        (!proof || proof.dataHash === event.dataHash) &&
        event.dataHash === calculateTraceEventHash(event),
    };
  }
}
