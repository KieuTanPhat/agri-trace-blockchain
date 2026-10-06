import { ForbiddenException, Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from './trace-hash.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: OrganizationAccessService,
  ) {}

  async createInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateTraceEventInput,
  ) {
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.entityType}:${input.entityId}`}, 0))`,
    );

    const heads = await tx.$queryRaw<Array<{ data_hash: string }>>(Prisma.sql`
      SELECT current_event.data_hash
      FROM public.trace_event AS current_event
      WHERE current_event.entity_type = ${input.entityType}
        AND current_event.entity_id = ${input.entityId}::uuid
        AND NOT EXISTS (
          SELECT 1
          FROM public.trace_event AS next_event
          WHERE next_event.entity_type = current_event.entity_type
            AND next_event.entity_id = current_event.entity_id
            AND next_event.previous_event_hash = current_event.data_hash
        )
      LIMIT 2
    `);

    if (heads.length > 1) {
      throw new ConflictException('Chuỗi sự kiện có nhiều điểm cuối');
    }

    const previousHash = heads[0]?.data_hash ?? null;
    const id = randomUUID();
    const eventTime = input.eventTime ?? new Date();

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
      previousEventHash: previousHash,
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
        previousEventHash: previousHash,
      },
    });

    await tx.blockchainProof.create({
      data: {
        eventId: event.id,
        network: process.env.FABRIC_NETWORK_NAME ?? 'hyperledger-fabric',
        channelId: process.env.FABRIC_CHANNEL_NAME ?? 'agritrace',
        dataHash,
        transactionStatus: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });

    return event;
  }

  async getLotHistory(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);

    return this.prisma.traceEvent.findMany({
      where: { lotId },
      orderBy: [{ eventTime: 'asc'}, { createdAt: 'asc'}],
      include: { blockchainProof: true},
    });
  }

  async getProof(eventId: string, actor: Actor) {
    const proof = await this.prisma.blockchainProof.findUnique({
      where: { eventId },
      include: { traceEvent: true },
    });
    if (!proof) throw new NotFoundException('Không tìm thấy blockchain proof');

    if(proof.traceEvent.lotId) {
      await this.access.assertLotAccess(actor, proof.traceEvent.lotId);
    } else if (proof.traceEvent.cycleId) {
      await this.access.assertProductionCycleAccess(
        actor,
        proof.traceEvent.cycleId,
      );
    } else {
      throw new ForbiddenException('Không xác định được quyền xem sự kiện');
    }

    return {
      eventId: proof.eventId,
      status: proof.transactionStatus,
      network: proof.network,
      channelId: proof.channelId,
      txId: proof.txId,
      dataHash: proof.dataHash,
      recordedAt: proof.recordedAt,
      localHashMatches:
        proof.dataHash === proof.traceEvent.dataHash &&
        proof.dataHash === calculateTraceEventHash(proof.traceEvent),
    };
  }
}
