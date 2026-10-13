import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { calculateTraceEventHash } from './trace-hash.js';
import {
  B_SCHEMA_VERSION,
  bindingEventCommitment,
  privateBodyDigest,
} from './binding-commitment.js';
import { reserveEventPermission } from '../ledger/ledger-permissions.js';
import {
  assertionDigest,
  C_SCHEMA_VERSION,
  signedBindingEventCommitment,
} from './signed-commitment.js';
import { localEvidence } from './event-evidence.js';
import { scopedTraceEventReadWhere } from '../supply-chains/business-read-scope.js';
import { getLotEventProofStatus } from '../lots/lot-proof-status.js';
import { OrganizationAccessService } from '../auth/organization-access.service.js';
import {
  activeWriteRoute,
  EVENT_BINDING_CONTEXT_INCLUDE,
  EVENT_LEDGER_ROUTE_INCLUDE,
  type PinnedRoute,
  sameLedgerDestination,
  verifiedEventRoute,
} from './ledger-route.js';

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
  supersedesEventId?: string;
  /** Pre-allocated event id (a signing intent names the event it authorizes). */
  eventId?: string;
  /** Release C: attach the already consumed organization signature. */
  signature?: { intentId: string };
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
    const roots = await tx.$queryRaw<
      Array<{ cycleId: string; chainId: string | null }>
    >`
      SELECT c.cycle_id AS "cycleId", c.chain_id AS "chainId" FROM production_cycle c
      WHERE c.cycle_id = ${input.cycleId ?? null}::uuid OR EXISTS (
        SELECT 1 FROM harvest_event h JOIN lot l ON l.harvest_id = h.harvest_id
        WHERE h.cycle_id = c.cycle_id AND l.lot_id = ${input.lotId ?? null}::uuid
      )`;
    if (roots.length > 1)
      throw new ConflictException('Trace subjects disagree');
    const chainId = roots[0]?.chainId ?? null;
    if (chainId) {
      if (
        !input.businessData ||
        typeof input.businessData !== 'object' ||
        Array.isArray(input.businessData)
      )
        throw new ConflictException('Scoped trace cần payload object');
      const data = input.businessData as Prisma.InputJsonObject;
      if (data.chainId && data.chainId !== chainId)
        throw new ConflictException('Trace chain context mismatch');
      input = {
        ...input,
        businessData: { ...input.businessData, chainId, scopeVersion: 1 },
      };
    }
    // Serialize hash-chain head creation per entity. Without this transaction
    // lock, two concurrent commands can both read the same predecessor and
    // produce sibling events that Fabric cannot append deterministically.
    await tx.$executeRaw(
      Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.entityType}:${input.entityId}`}, 0))`,
    );
    const id = input.eventId ?? randomUUID();
    const eventTime = input.eventTime ?? new Date();
    // Business timestamps may be backdated, and transaction timestamps may tie.
    // The predecessor is the chain's leaf, not the newest business timestamp.
    const heads = await tx.$queryRaw<
      Array<{ eventId: string; dataHash: string }>
    >(Prisma.sql`
      SELECT current_event.event_id AS "eventId", current_event.data_hash AS "dataHash"
      FROM trace_event current_event
      WHERE current_event.entity_type = ${input.entityType}
        AND current_event.entity_id = ${input.entityId}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM trace_event successor
          WHERE successor.entity_type = current_event.entity_type
            AND successor.entity_id = current_event.entity_id
            AND successor.previous_event_hash = current_event.data_hash
        )
      LIMIT 2
    `);
    if (heads.length > 1)
      throw new ConflictException('Trace event chain has multiple heads');
    const previous = heads[0];
    // Release B: a cycle born on a binding stays on it for life; every child
    // (care, harvest, Lot, Shipment...) resolves its origin through the cycle.
    const originCycleId = roots[0]?.cycleId ?? null;
    const origin = originCycleId
      ? await tx.cycleLedgerContext.findUnique({
          where: { cycleId: originCycleId },
          include: { binding: { include: { state: true, route: true } } },
        })
      : null;
    if (origin && origin.binding.state?.status !== 'ACTIVE')
      throw new ServiceUnavailableException('Binding ledger đang tạm dừng');
    const route: PinnedRoute = origin
      ? (origin.binding.route as PinnedRoute)
      : await activeWriteRoute(tx);
    if (previous) {
      const sidecar = await tx.eventLedgerRoute.findUnique({
        where: { eventId: previous.eventId },
        ...EVENT_LEDGER_ROUTE_INCLUDE,
      });
      const predecessor = verifiedEventRoute({
        id: previous.eventId,
        dataHash: previous.dataHash,
        ledgerRoute: sidecar,
      });
      if (
        !predecessor ||
        !sameLedgerDestination(predecessor, route) ||
        (origin && predecessor.bindingDigest !== route.bindingDigest)
      )
        throw new ConflictException(
          'Ledger predecessor cần route cùng destination đã xác minh',
        );
    }
    // Release C: a signed event must come from a binding stream and from an
    // intent that was consumed for exactly this event, entity and binding.
    const signed = input.signature
      ? await tx.signingIntent.findUnique({
          where: { id: input.signature.intentId },
          include: { key: true },
        })
      : null;
    if (input.signature) {
      if (
        !origin ||
        !signed ||
        signed.status !== 'CONSUMED' ||
        !signed.signature ||
        signed.eventId !== id ||
        signed.entityType !== input.entityType ||
        signed.entityId !== input.entityId ||
        signed.eventType !== input.eventType ||
        signed.bindingDigest !== origin.bindingDigest ||
        signed.chainId !== chainId ||
        signed.key.status !== 'ACTIVE'
      )
        throw new ConflictException(
          'Chữ ký không khớp sự kiện, thực thể hoặc binding',
        );
      input = {
        ...input,
        businessData: {
          ...(input.businessData as Prisma.InputJsonObject),
          actorSignature: {
            intent: signed.intent,
            payload: signed.payload,
            assertion: {
              algorithm: 'Ed25519',
              keyRef: signed.keyRef,
              intentDigest: signed.intentDigest,
              signature: signed.signature,
            },
            signerOrgId: signed.organizationId,
          },
        } as Prisma.InputJsonObject,
      };
    }
    const actorAuthProof = createHash('sha256')
      .update(`${input.actor.sub}:${input.actor.role}`, 'utf8')
      .digest('hex');
    const authProofType = input.actor.sub
      ? 'TOKEN_FINGERPRINT'
      : 'SYSTEM_ASSERTION';
    const hashInput = {
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
    };
    // B events hash the private body (V2 shape) and then commit to the public
    // context: binding, chain reference and the permission epoch captured here.
    const captured = origin
      ? await reserveEventPermission(
          tx,
          origin.bindingDigest,
          input.actor,
          input.entityType,
        )
      : null;
    const bodyDigest = origin ? privateBodyDigest(hashInput) : null;
    const assertion = signed
      ? {
          algorithm: 'Ed25519' as const,
          keyRef: signed.keyRef,
          intentDigest: signed.intentDigest,
          signature: signed.signature!,
        }
      : null;
    const commit =
      origin && captured && bodyDigest
        ? (context: Parameters<typeof bindingEventCommitment>[0]) =>
            assertion
              ? signedBindingEventCommitment(context, bodyDigest, {
                  keyRef: assertion.keyRef,
                  intentDigest: assertion.intentDigest,
                  assertionDigest: assertionDigest(assertion),
                })
              : bindingEventCommitment(context, bodyDigest)
        : null;
    const dataHash =
      origin && captured && bodyDigest && commit
        ? commit({
            eventId: id,
            entityType: input.entityType,
            entityId: input.entityId,
            cycleId: input.cycleId ?? null,
            lotId: input.lotId ?? null,
            eventType: input.eventType,
            eventTime,
            previousEventHash: previous?.dataHash ?? null,
            bindingDigest: origin.bindingDigest,
            chainRef: origin.binding.chainRef,
            permissions: [
              {
                permissionRef: captured.permissionRef,
                epoch: String(captured.epoch),
                ordinal: String(captured.ordinal),
              },
            ],
          })
        : calculateTraceEventHash(hashInput);

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
        schemaVersion: origin
          ? signed
            ? C_SCHEMA_VERSION
            : B_SCHEMA_VERSION
          : '2.0.0',
        canonicalizationVersion: 'RFC8785',
        eventTime,
        businessData: input.businessData,
        dataHash,
        previousEventHash: previous?.dataHash,
        supersedesEventId: input.supersedesEventId,
      },
    });

    await tx.eventLedgerRoute.create({
      data: { eventId: event.id, definitionDigest: route.digest },
    });
    await tx.blockchainOutbox.create({
      data: {
        eventId: event.id,
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
    if (chainId)
      await tx.eventChainContext.create({
        data: { eventId: event.id, chainId },
      });
    if (origin && captured && bodyDigest) {
      await tx.eventBindingContext.create({
        data: {
          eventId: event.id,
          bindingDigest: origin.bindingDigest,
          privateBodyDigest: bodyDigest,
          ...(signed ? { commitmentVersion: 'c1' } : {}),
        },
      });
      await tx.eventPermissionEpoch.create({
        data: {
          eventId: event.id,
          permissionRef: captured.permissionRef,
          epoch: captured.epoch,
          ordinal: captured.ordinal,
        },
      });
      if (signed && assertion)
        await tx.eventActorSignature.create({
          data: {
            eventId: event.id,
            intentId: signed.id,
            keyRef: signed.keyRef,
            bindingDigest: signed.bindingDigest,
            organizationId: signed.organizationId,
            intentDigest: signed.intentDigest,
            assertionDigest: assertionDigest(assertion),
            signature: assertion.signature,
          },
        });
    }
    return event;
  }

  async getLotHistory(lotId: string, actor: Actor) {
    await this.access.assertLotAccess(actor, lotId);
    return this.prisma.traceEvent.findMany({
      where: { AND: [{ lotId }, scopedTraceEventReadWhere(actor)] },
      orderBy: [{ eventTime: 'asc' }, { createdAt: 'asc' }],
      include: { blockchainProof: true, blockchainOutbox: true },
    });
  }

  async getProof(eventId: string, actor: Actor) {
    await this.access.assertTraceEventAccess(actor, eventId);
    const event = await this.prisma.traceEvent.findFirst({
      where: { AND: [{ id: eventId }, scopedTraceEventReadWhere(actor)] },
      include: {
        blockchainProof: true,
        blockchainOutbox: true,
        ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
        ledgerRouteExemption: true,
        bindingContext: EVENT_BINDING_CONTEXT_INCLUDE,
      },
    });
    if (!event) throw new NotFoundException('Không tìm thấy trace event');
    const proof = event.blockchainProof;
    const { route, sensorMatches, localHashMatches } = await localEvidence(
      this.prisma,
      event,
    );
    return {
      eventId,
      network: route?.network ?? null,
      channelId: route?.channelId ?? null,
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
      localHashMatches,
      proofStatus: sensorMatches
        ? getLotEventProofStatus(event)
        : 'INTEGRITY_WARNING',
    };
  }
}
