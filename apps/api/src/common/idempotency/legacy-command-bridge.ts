import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../crypto/rfc8785.js';
import {
  authorizeCommand,
  type AuthorizedCommand,
} from './command-authorization.js';
import { assertLegacyScopeProvenance } from '../../modules/supply-chains/legacy-scope-pins.js';
import { businessRoot } from '../../modules/supply-chains/business-policy.js';
import { legacyCreationReplayRoot } from '../../modules/supply-chains/legacy-creation-replay.js';

export async function replayRoot(
  db: Parameters<typeof businessRoot>[0],
  input: AuthorizedCommand,
) {
  const payload = input.payload as Record<string, unknown>;
  const operation = input.operation;
  if (['CREATE_PRODUCTION_CYCLE', 'CREATE_SHIPMENT'].includes(operation)) {
    const root = await legacyCreationReplayRoot(db, input);
    if (root) return root;
    throw new ConflictException(
      'Legacy creation thiếu journal/provenance hợp lệ',
    );
  }
  if (
    [
      'PLANT_PRODUCTION_CYCLE',
      'RECORD_CARE',
      'RECORD_SENSOR',
      'CLOSE_PRODUCTION_CYCLE',
      'CANCEL_PRODUCTION_CYCLE',
      'RECORD_HARVEST',
      'CREATE_SENSOR_DIGEST',
      'RECONCILE_CYCLE_SENSOR',
      'INGEST_SENSOR_READING',
    ].includes(operation)
  )
    return businessRoot(db, {
      kind: 'cycle',
      id: String(payload.cycleId ?? payload.id),
    });
  if (
    [
      'DAMAGE_LOT',
      'MARK_FOR_SALE',
      'MARK_SOLD',
      'RECALL_LOT',
      'EXPIRE_LOT',
      'CREATE_INSPECTION',
    ].includes(operation)
  )
    return businessRoot(db, { kind: 'lot', id: String(payload.lotId) });
  if (
    [
      'START_SHIPMENT',
      'ARRIVE_SHIPMENT',
      'RECEIVE_SHIPMENT',
      'REJECT_SHIPMENT',
      'DAMAGE_SHIPMENT',
      'INGEST_SHIPMENT_TELEMETRY',
      'BIND_SHIPMENT_DEVICE',
      'UNBIND_SHIPMENT_DEVICE',
      'CREATE_SHIPMENT_TELEMETRY_DIGEST',
    ].includes(operation)
  )
    return businessRoot(db, {
      kind: 'shipment',
      id: String(payload.shipmentId ?? payload.id),
    });
  if (operation === 'CREATE_CERTIFICATE')
    return businessRoot(
      db,
      payload.lotId
        ? { kind: 'lot', id: String(payload.lotId) }
        : { kind: 'cycle', id: String(payload.cycleId) },
    );
  if (operation === 'REVIEW_CERTIFICATE') {
    const certificate = await db.certificate.findUniqueOrThrow({
      where: { id: String(payload.id) },
    });
    return businessRoot(
      db,
      certificate.lotId
        ? { kind: 'lot', id: certificate.lotId }
        : { kind: 'cycle', id: certificate.cycleId! },
    );
  }
  throw new ConflictException(
    'Legacy command cần đối soát riêng; không execute lại',
  );
}

/** Only a positive immutable legacy journal may acquire a versioned sidecar.
 * It preserves the old record/scope/body and checks the actor grant captured
 * at cutover, current session/authority, request hash and manifest pin under
 * write locks. Regrant cannot create a new bridge to an old response. */
export async function ensureLegacyCommandBridge(
  prisma: PrismaService,
  input: AuthorizedCommand & {
    idempotencyKey: string;
    authorizationScope: string;
    requestHash: string;
  },
  recordId: string,
) {
  return prisma.$transaction(
    (tx) => ensureLegacyCommandBridgeInTransaction(tx, input, recordId),
    { maxWait: 5000, timeout: 20000 },
  );
}

export async function ensureLegacyCommandBridgeInTransaction(
  tx: Prisma.TransactionClient,
  input: AuthorizedCommand & {
    idempotencyKey: string;
    authorizationScope: string;
    requestHash: string;
  },
  recordId: string,
) {
  await tx.$queryRaw`SELECT idempotency_record_id FROM idempotency_record WHERE idempotency_record_id=${recordId}::uuid FOR UPDATE`;
  const scope = await authorizeCommand(tx, input, true);
  if (
    scope !== input.authorizationScope ||
    !input.actor ||
    !input.businessActor
  )
    throw new ConflictException('Legacy replay scope đã thay đổi');
  const record = await tx.idempotencyRecord.findUniqueOrThrow({
    where: { id: recordId },
  });
  const journal = await tx.commandCommit.findUnique({
    where: { idempotencyRecordId: recordId },
  });
  if (
    !journal ||
    record.requestHash !== input.requestHash ||
    record.operation !== input.operation ||
    record.requesterId !== input.requesterId ||
    journal.requesterId !== input.requesterId ||
    journal.operation !== input.operation ||
    journal.authorizationScope !== record.authorizationScope
  )
    throw new ConflictException(
      'Legacy command thiếu journal khớp; cần đối soát',
    );
  const actorScope = journal.actorScope as Record<string, unknown>;
  if (
    actorScope.organizationId !== input.businessActor.organizationId ||
    actorScope.role !== input.businessActor.role
  )
    throw new ConflictException(
      'Legacy journal actor không khớp vai trò thực hiện',
    );
  const root = await replayRoot(tx, input);
  const mapping = await tx.legacyScopeMapping.findUnique({
    where: { cycleId: root.cycle.id },
  });
  if (!mapping?.chainId || mapping.chainId !== root.cycle.chainId)
    throw new ConflictException('Legacy replay chưa có cutover provenance');
  await assertLegacyScopeProvenance(tx, root.cycle.id);
  const grant = await tx.scopedRoleGrant.findFirst({
    where: {
      chainId: mapping.chainId,
      userId: input.actor.sub!,
      organizationId: input.actor.organizationId!,
      role: input.businessActor.role as
        'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER',
      scope: 'CHAIN',
      revokedAt: null,
    },
  });
  const snapshot = mapping.actorGrants as Array<{
    userId: string;
    grantId: string;
    grantRevision: number;
    role: string;
  }>;
  if (
    !grant ||
    !snapshot.some(
      (g) =>
        g.userId === input.requesterId &&
        g.grantId === grant.id &&
        g.grantRevision === grant.revision &&
        g.role === input.businessActor!.role,
    )
  )
    throw new ConflictException('Grant mới không hồi sinh legacy replay');
  const journalDigest = canonicalSha256(JSON.parse(JSON.stringify(journal)));
  const previous = await tx.legacyCommandBridge.findUnique({
    where: { commandCommitId: journal.id },
  });
  if (
    previous &&
    (previous.protocolVersion !== 1 ||
      previous.targetScope !== scope ||
      previous.journalDigest !== journalDigest ||
      previous.manifestId !== mapping.manifestId ||
      previous.cycleId !== root.cycle.id)
  )
    throw new ConflictException(
      'Legacy bridge không khớp epoch/journal/provenance',
    );
  if (!previous)
    await tx.legacyCommandBridge.create({
      data: {
        commandCommitId: journal.id,
        manifestId: mapping.manifestId,
        cycleId: root.cycle.id,
        targetScope: scope,
        journalDigest,
      },
    });
  return journal;
}
