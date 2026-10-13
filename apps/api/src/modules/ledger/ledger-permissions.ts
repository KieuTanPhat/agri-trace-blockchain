import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma, ScopedRole } from '../../generated/prisma/client.js';

/** Ledger entity types a scoped role may write. Reads, administration and the
 * organization-level roles never reach the ledger. The list is registered with
 * each permission epoch so the chaincode enforces it independently. */
const ROLE_ENTITY_TYPES: Partial<Record<ScopedRole, readonly string[]>> = {
  FARM_STAFF: [
    'CARE',
    'CERTIFICATE',
    'HARVEST',
    'LOT',
    'PRODUCTION_CYCLE',
    'SENSOR',
    'SENSOR_DIGEST',
  ],
  TRANSPORTER: ['LOT', 'SHIPMENT', 'SHIPMENT_TELEMETRY'],
  RETAILER: ['LOT', 'SHIPMENT'],
  CHAIN_MANAGER: ['SHIPMENT'],
  COMPLIANCE_REVIEWER: ['CERTIFICATE', 'INSPECTION', 'SENSOR_DIGEST'],
};

export function ledgerEntityTypes(role: ScopedRole): string[] | null {
  const types = ROLE_ENTITY_TYPES[role];
  return types ? [...types] : null;
}

/** Each epoch contributes exactly two registry revisions (grant, revoke). */
export const grantRevision = (epoch: number) => 2 * (epoch - 1);
export const revokeRevision = (epoch: number) => 2 * (epoch - 1) + 1;

type GrantRef = {
  id: string;
  userId: string;
  organizationId: string;
  chainId: string | null;
  role: ScopedRole;
};

export async function activeChainBindingDigest(
  tx: Prisma.TransactionClient,
  chainId: string,
): Promise<string | null> {
  const profile = await tx.chainLedgerProfile.findUnique({
    where: { chainId },
    select: { activeBindingDigest: true },
  });
  return profile?.activeBindingDigest ?? null;
}

/** DB grant -> ledger permission epoch + control job, in the grant's own
 * transaction. The ledger grant is confirmed asynchronously; until then the
 * permission is REQUESTED and no event can capture it. */
export async function requestLedgerGrant(
  tx: Prisma.TransactionClient,
  grant: GrantRef,
  bindingDigest?: string,
) {
  const types = ledgerEntityTypes(grant.role);
  if (!grant.chainId || !types) return null;
  const digest =
    bindingDigest ?? (await activeChainBindingDigest(tx, grant.chainId));
  if (!digest) return null;
  const subject = {
    bindingDigest: digest,
    userId: grant.userId,
    role: grant.role,
  };
  let permission = await tx.ledgerPermission.findUnique({
    where: { bindingDigest_userId_role: subject },
  });
  let epoch = 1;
  if (!permission) {
    permission = await tx.ledgerPermission.create({
      data: { ...subject, organizationId: grant.organizationId },
    });
    await tx.ledgerPermissionEpoch.create({
      data: {
        permissionRef: permission.permissionRef,
        epoch,
        grantId: grant.id,
        entityTypes: types,
      },
    });
    await tx.ledgerPermissionSync.create({
      data: { permissionRef: permission.permissionRef, requestedEpoch: epoch },
    });
  } else {
    const [sync] = await tx.$queryRaw<
      Array<{ state: string; requestedEpoch: number }>
    >`SELECT state::text AS state, requested_epoch AS "requestedEpoch" FROM ledger_permission_sync WHERE permission_ref = ${permission.permissionRef}::uuid FOR UPDATE`;
    if (!['REVOKED', 'REVOKED_REVIEW_REQUIRED'].includes(sync.state))
      throw new ConflictException(
        'Quyền ledger trước đó chưa được thu hồi xong',
      );
    epoch = sync.requestedEpoch + 1;
    await tx.ledgerPermissionEpoch.create({
      data: {
        permissionRef: permission.permissionRef,
        epoch,
        grantId: grant.id,
        entityTypes: types,
      },
    });
    await tx.ledgerPermissionSync.update({
      where: { permissionRef: permission.permissionRef },
      data: {
        state: 'REQUESTED',
        requestedEpoch: epoch,
        barrierOrdinal: null,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });
  }
  await tx.ledgerControlJob.create({
    data: {
      bindingDigest: digest,
      operation: 'PERMISSION_GRANT',
      permissionRef: permission.permissionRef,
      epoch,
      expectedRevision: grantRevision(epoch),
    },
  });
  return { permissionRef: permission.permissionRef, epoch };
}

/** Revocation. The API denies the grant immediately (DB grant revoked in the
 * same transaction); this only schedules the ledger side. Normal revoke fixes a
 * barrier at the last captured ordinal and drains events queued before it;
 * emergency revoke holds delivery at once and revokes without draining. */
export async function requestLedgerRevoke(
  tx: Prisma.TransactionClient,
  grantId: string,
  mode: 'NORMAL' | 'EMERGENCY' = 'NORMAL',
  reason = 'grant revoked',
) {
  const epochRow = await tx.ledgerPermissionEpoch.findUnique({
    where: { grantId },
    include: { permission: true },
  });
  if (!epochRow) return null;
  const ref = epochRow.permissionRef;
  const [sync] = await tx.$queryRaw<
    Array<{ state: string; requestedEpoch: number; nextOrdinal: bigint }>
  >`SELECT state::text AS state, requested_epoch AS "requestedEpoch", next_ordinal AS "nextOrdinal" FROM ledger_permission_sync WHERE permission_ref = ${ref}::uuid FOR UPDATE`;
  if (!sync || sync.requestedEpoch !== epochRow.epoch) return null;
  const barrier = sync.nextOrdinal - 1n;
  const job = (
    operation: 'PERMISSION_REVOKE' | 'PERMISSION_EMERGENCY_REVOKE',
  ) =>
    tx.ledgerControlJob.create({
      data: {
        bindingDigest: epochRow.permission.bindingDigest,
        operation,
        permissionRef: ref,
        epoch: epochRow.epoch,
        expectedRevision: revokeRevision(epochRow.epoch),
      },
    });
  const hold = () =>
    tx.deliveryHold.create({
      data: {
        bindingDigest: epochRow.permission.bindingDigest,
        scope: 'PERMISSION',
        permissionRef: ref,
        reason: `${reason}: emergency hold`,
      },
    });
  const set = (state: string, extra: Record<string, unknown> = {}) =>
    tx.ledgerPermissionSync.update({
      where: { permissionRef: ref },
      data: {
        state: state as never,
        barrierOrdinal: barrier,
        version: { increment: 1 },
        updatedAt: new Date(),
        ...extra,
      },
    });
  if (sync.state === 'REQUESTED') {
    const pending = await tx.ledgerControlJob.updateMany({
      where: {
        permissionRef: ref,
        epoch: epochRow.epoch,
        operation: 'PERMISSION_GRANT',
        status: 'PENDING',
      },
      data: {
        status: 'FAILED',
        lastError: 'cancelled: revoked before ledger grant',
        updatedAt: new Date(),
      },
    });
    if (pending.count === 1) {
      await tx.ledgerPermissionSync.update({
        where: { permissionRef: ref },
        data: {
          state: 'REVOKED',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      return { permissionRef: ref, outcome: 'CANCELLED_BEFORE_LEDGER' };
    }
    // The grant job may already be in flight: treat it as possibly committed.
    return mode === 'EMERGENCY' ? emergency() : normal();
  }
  if (['PENDING_LEDGER', 'ACTIVE'].includes(sync.state))
    return mode === 'EMERGENCY' ? emergency() : normal();
  if (
    mode === 'EMERGENCY' &&
    ['REVOKE_REQUESTED', 'DRAINING', 'PENDING_REVOKE_LEDGER'].includes(
      sync.state,
    )
  )
    return emergency();
  return { permissionRef: ref, outcome: 'NO_CHANGE' };

  async function normal() {
    await set('REVOKE_REQUESTED');
    await job('PERMISSION_REVOKE');
    return {
      permissionRef: ref,
      outcome: 'REVOKE_REQUESTED',
      barrierOrdinal: barrier,
    };
  }
  async function emergency() {
    await set('EMERGENCY_HOLD');
    await hold();
    await job('PERMISSION_EMERGENCY_REVOKE');
    return {
      permissionRef: ref,
      outcome: 'EMERGENCY_HOLD',
      barrierOrdinal: barrier,
    };
  }
}

export type CapturedPermission = {
  permissionRef: string;
  epoch: number;
  ordinal: bigint;
};

/** Event enqueue: capture the actor's confirmed ACTIVE ledger permission and
 * reserve the next ordinal under its row lock (same lock the barrier uses). */
export async function reserveEventPermission(
  tx: Prisma.TransactionClient,
  bindingDigest: string,
  actor: { sub: string | null; role: string },
  entityType: string,
): Promise<CapturedPermission> {
  if (!actor.sub)
    throw new ConflictException('Sự kiện ledger cần người thực hiện có quyền');
  const permission = await tx.ledgerPermission.findUnique({
    where: {
      bindingDigest_userId_role: {
        bindingDigest,
        userId: actor.sub,
        role: actor.role as ScopedRole,
      },
    },
  });
  if (!permission)
    throw new ConflictException('Chưa có quyền ledger cho vai trò này');
  const openHold = await tx.deliveryHold.findFirst({
    where: {
      bindingDigest,
      resolvedAt: null,
      OR: [{ scope: 'BINDING' }, { permissionRef: permission.permissionRef }],
    },
    select: { id: true },
  });
  if (openHold)
    throw new ServiceUnavailableException(
      'Binding hoặc quyền đang bị giữ để rà soát',
    );
  const [sync] = await tx.$queryRaw<
    Array<{
      state: string;
      requestedEpoch: number;
      confirmedEpoch: number | null;
      nextOrdinal: bigint;
    }>
  >`SELECT state::text AS state, requested_epoch AS "requestedEpoch", confirmed_epoch AS "confirmedEpoch", next_ordinal AS "nextOrdinal" FROM ledger_permission_sync WHERE permission_ref = ${permission.permissionRef}::uuid FOR UPDATE`;
  if (
    !sync ||
    sync.state !== 'ACTIVE' ||
    sync.confirmedEpoch !== sync.requestedEpoch
  )
    throw new ServiceUnavailableException(
      'Quyền ledger chưa được xác nhận trên ledger (hoặc đang bị thu hồi)',
    );
  const epoch = await tx.ledgerPermissionEpoch.findUniqueOrThrow({
    where: {
      permissionRef_epoch: {
        permissionRef: permission.permissionRef,
        epoch: sync.requestedEpoch,
      },
    },
  });
  if (!epoch.entityTypes.includes(entityType))
    throw new ConflictException(
      `Quyền ledger của vai trò ${actor.role} không bao phủ ${entityType}`,
    );
  await tx.ledgerPermissionSync.update({
    where: { permissionRef: permission.permissionRef },
    data: {
      nextOrdinal: { increment: 1 },
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });
  return {
    permissionRef: permission.permissionRef,
    epoch: sync.requestedEpoch,
    ordinal: sync.nextOrdinal,
  };
}
