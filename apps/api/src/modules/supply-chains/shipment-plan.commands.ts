import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type {
  Prisma,
  ShipmentPlanParty,
  ShipmentPlanRevision,
} from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { lockAggregate } from '../../common/idempotency/command-transaction.js';
import { quantity } from '../../common/quantity.js';
import { businessTimestamp } from '../../common/timestamp.js';
import { authorizeBusinessCommand, businessRoot } from './business-policy.js';
import { lockChainScope, organizationGrant } from './chain-policy.js';

export interface DraftShipmentPlan {
  transporterOrgId: string;
  retailerOrgId: string;
  quantity: string;
  unit: string;
  origin: string;
  destination: string;
  vehicleRef?: string;
  plannedPickupTime?: string;
  expectedArrivalTime?: string;
}

const PARTY = {
  PRODUCER: { field: 'producerOrgId', capability: 'FARM' },
  TRANSPORTER: { field: 'transporterOrgId', capability: 'TRANSPORTER' },
  RETAILER: { field: 'retailerOrgId', capability: 'RETAILER' },
} as const;

function assertActor(actor: CommandActor) {
  if (!actor.sub || !actor.organizationId || actor.role === 'SYSTEM_ADMIN')
    throw new ForbiddenException('Cần người dùng của tổ chức được cấp quyền');
}

/** Run only inside the eventual command/journal transaction. Acquire all org
 * scope locks before the chain lock, including newly proposed participants.
 * No endpoint or feature activation is exposed by this candidate module. */
async function lockContext(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  chainId: string,
  organizations: string[],
) {
  assertActor(actor);
  const ids = [...new Set([actor.organizationId!, ...organizations])].sort();
  if (![chainId, actor.sub!, ...ids].every((id) => isUUID(id)))
    throw new UnprocessableEntityException('Định danh kế hoạch không hợp lệ');
  for (const id of ids)
    await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${id}::uuid FOR SHARE`;
  await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${actor.sub}::uuid FOR SHARE`;
  for (const id of ids) await lockChainScope(db, `org:${id}`);
  await lockChainScope(db, chainId);
  await db.$queryRaw`SELECT chain_id FROM chain_business_profile WHERE chain_id = ${chainId}::uuid FOR SHARE`;
}

function payload(input: DraftShipmentPlan, producerOrgId: string) {
  const plannedPickupTime = input.plannedPickupTime
    ? businessTimestamp(input.plannedPickupTime, 'Dự kiến lấy hàng', {
        allowFuture: true,
      })
    : null;
  const expectedArrivalTime = input.expectedArrivalTime
    ? businessTimestamp(input.expectedArrivalTime, 'Dự kiến đến', {
        allowFuture: true,
        notBefore: plannedPickupTime ?? undefined,
      })
    : null;
  const fields = {
    unit: input.unit.trim(),
    origin: input.origin.trim(),
    destination: input.destination.trim(),
  };
  if (
    !fields.unit ||
    fields.unit.length > 30 ||
    !fields.origin ||
    !fields.destination
  )
    throw new UnprocessableEntityException(
      'Thiếu đơn vị, điểm đi hoặc điểm đến',
    );
  return {
    ...fields,
    producerOrgId,
    transporterOrgId: input.transporterOrgId,
    retailerOrgId: input.retailerOrgId,
    quantity: quantity(input.quantity),
    vehicleRef: input.vehicleRef?.trim() || null,
    plannedPickupTime,
    expectedArrivalTime,
  };
}

export function shipmentPlanDigest(
  chainId: string,
  lotId: string,
  revision: number,
  value: Pick<
    ShipmentPlanRevision,
    | 'producerOrgId'
    | 'transporterOrgId'
    | 'retailerOrgId'
    | 'quantity'
    | 'unit'
    | 'origin'
    | 'destination'
    | 'vehicleRef'
    | 'plannedPickupTime'
    | 'expectedArrivalTime'
  >,
) {
  return canonicalSha256({
    protocol: 'shipment-plan-v1',
    chainId,
    lotId,
    revision,
    producerOrgId: value.producerOrgId,
    transporterOrgId: value.transporterOrgId,
    retailerOrgId: value.retailerOrgId,
    quantity: value.quantity.toFixed(3),
    unit: value.unit,
    origin: value.origin,
    destination: value.destination,
    vehicleRef: value.vehicleRef,
    plannedPickupTime: value.plannedPickupTime?.toISOString() ?? null,
    expectedArrivalTime: value.expectedArrivalTime?.toISOString() ?? null,
  });
}

async function draftLot(
  db: Prisma.TransactionClient,
  chainId: string,
  lotId: string,
  value: ReturnType<typeof payload>,
) {
  await lockAggregate(db, 'lot', lotId);
  const lot = await db.lot.findUnique({
    where: { id: lotId },
    include: {
      shipment: { select: { id: true } },
      harvest: { select: { cycle: { select: { chainId: true } } } },
    },
  });
  if (!lot || lot.harvest.cycle.chainId !== chainId)
    throw new NotFoundException('Không tìm thấy lô trong chuỗi');
  if (
    lot.currentState !== 'HARVESTED' ||
    lot.shipment ||
    !lot.availableQuantity.greaterThan(0)
  )
    throw new ConflictException('Lô không còn sẵn sàng lập kế hoạch');
  if (!lot.availableQuantity.equals(value.quantity) || lot.unit !== value.unit)
    throw new ConflictException(
      'Kế hoạch phải dùng toàn bộ lượng khả dụng và đúng đơn vị',
    );
  return lot;
}

async function audit(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  chainId: string,
  operation: string,
  id: string,
  revision: number,
) {
  await db.chainAudit.create({
    data: {
      chainId,
      actorUserId: actor.sub!,
      operation,
      subjectId: id,
      revision,
    },
  });
}

export async function createShipmentPlan(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  chainId: string,
  lotId: string,
  input: DraftShipmentPlan,
) {
  const root = await businessRoot(db, { kind: 'lot', id: lotId });
  const value = payload(input, root.cycle.farmOrgId);
  await lockContext(db, actor, chainId, [
    value.producerOrgId,
    value.transporterOrgId,
    value.retailerOrgId,
  ]);
  await authorizeBusinessCommand(
    db,
    actor,
    { chainId, role: 'CHAIN_MANAGER', subject: { kind: 'lot', id: lotId } },
    true,
  );
  await draftLot(db, chainId, lotId, value);
  const plan = await db.shipmentPlan.create({ data: { chainId, lotId } });
  await db.shipmentPlanRevision.create({
    data: {
      planId: plan.id,
      revision: 0,
      ...value,
      payloadDigest: shipmentPlanDigest(chainId, lotId, 0, value),
    },
  });
  await audit(db, actor, chainId, 'CREATE_SHIPMENT_PLAN', plan.id, 0);
  return db.shipmentPlan.findUniqueOrThrow({
    where: { id: plan.id },
    include: { current: true },
  });
}

async function planBeforeLock(db: Prisma.TransactionClient, id: string) {
  const plan = await db.shipmentPlan.findUnique({
    where: { id },
    include: { current: true },
  });
  if (!plan) throw new NotFoundException('Không tìm thấy kế hoạch');
  return plan;
}

async function lockedPlan(
  db: Prisma.TransactionClient,
  id: string,
  version: number,
) {
  await db.$queryRaw`SELECT plan_id FROM shipment_plan WHERE plan_id = ${id}::uuid FOR UPDATE`;
  const plan = await planBeforeLock(db, id);
  if (plan.version !== version || plan.status !== 'DRAFT')
    throw new ConflictException('Kế hoạch đã thay đổi hoặc không còn nháp');
  return plan;
}

export async function reviseShipmentPlan(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  id: string,
  version: number,
  input: DraftShipmentPlan,
) {
  const initial = await planBeforeLock(db, id);
  const value = payload(input, initial.current.producerOrgId);
  await lockContext(db, actor, initial.chainId, [
    value.producerOrgId,
    value.transporterOrgId,
    value.retailerOrgId,
    initial.current.transporterOrgId,
    initial.current.retailerOrgId,
  ]);
  await authorizeBusinessCommand(
    db,
    actor,
    {
      chainId: initial.chainId,
      role: 'CHAIN_MANAGER',
      subject: { kind: 'lot', id: initial.lotId },
    },
    true,
  );
  const plan = await lockedPlan(db, id, version);
  await draftLot(db, plan.chainId, plan.lotId, value);
  const revision = plan.currentRevision + 1;
  await db.shipmentPlanRevision.create({
    data: {
      planId: id,
      revision,
      ...value,
      payloadDigest: shipmentPlanDigest(
        plan.chainId,
        plan.lotId,
        revision,
        value,
      ),
    },
  });
  await db.shipmentPlan.update({
    where: { id },
    data: { currentRevision: revision, version: { increment: 1 } },
  });
  await audit(db, actor, plan.chainId, 'REVISE_SHIPMENT_PLAN', id, revision);
  return db.shipmentPlan.findUniqueOrThrow({
    where: { id },
    include: { current: true },
  });
}

/** Scope-only portion is reusable before replay. Lifecycle checks belong to
 * acceptShipmentPlan, so a legitimate replay can survive finalization. */
export async function authorizePlanAcceptance(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  id: string,
  party: ShipmentPlanParty,
  revision: number,
  digest: string,
) {
  assertActor(actor);
  const plan = await planBeforeLock(db, id);
  if (
    !(party in PARTY) ||
    plan.currentRevision !== revision ||
    plan.current.payloadDigest !== digest ||
    shipmentPlanDigest(plan.chainId, plan.lotId, revision, plan.current) !==
      digest
  )
    throw new ConflictException('Revision hoặc nội dung kế hoạch đã thay đổi');
  const spec = PARTY[party];
  if (plan.current[spec.field] !== actor.organizationId)
    throw new ForbiddenException('Không xác nhận thay đối tác');
  const user = await db.user.findUnique({
    where: { id: actor.sub! },
    include: { organization: true },
  });
  const membership = await db.chainMembership.findUnique({
    where: {
      chainId_organizationId: {
        chainId: plan.chainId,
        organizationId: actor.organizationId!,
      },
    },
  });
  const profile = await db.chainBusinessProfile.findUnique({
    where: { chainId: plan.chainId },
  });
  const capability = await db.organizationCapability.findUnique({
    where: {
      organizationId_code: {
        organizationId: actor.organizationId!,
        code: spec.capability,
      },
    },
  });
  const grant = await organizationGrant(db, actor, 'ORG_ADMIN');
  if (
    !user ||
    user.accountStatus !== 'ACTIVE' ||
    user.organizationId !== actor.organizationId ||
    user.organization?.status !== 'ACTIVE' ||
    membership?.status !== 'ACTIVE' ||
    profile?.state !== 'ACTIVE' ||
    profile.scopeVersion !== 1 ||
    !capability ||
    capability.revokedAt ||
    !grant
  )
    throw new ForbiddenException('Chưa có quyền xác nhận kế hoạch');
  return {
    plan,
    grant,
    scope: canonicalSha256({
      protocol: 'shipment-plan-consent-v1',
      user: actor.sub,
      organization: actor.organizationId,
      chainId: plan.chainId,
      planId: id,
      party,
      revision,
      digest,
      grant: { id: grant.id, revision: grant.revision },
      membership: { id: membership.id, version: membership.version },
      profile: { version: profile.version, scopeVersion: profile.scopeVersion },
      capability: { code: capability.code, revision: capability.revision },
    }),
  };
}

export async function acceptShipmentPlan(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  id: string,
  party: ShipmentPlanParty,
  revision: number,
  digest: string,
) {
  const initial = await planBeforeLock(db, id);
  await lockContext(db, actor, initial.chainId, [
    initial.current.producerOrgId,
    initial.current.transporterOrgId,
    initial.current.retailerOrgId,
  ]);
  await db.$queryRaw`SELECT plan_id FROM shipment_plan WHERE plan_id = ${id}::uuid FOR UPDATE`;
  const { plan, grant } = await authorizePlanAcceptance(
    db,
    actor,
    id,
    party,
    revision,
    digest,
  );
  if (plan.status !== 'DRAFT')
    throw new ConflictException('Kế hoạch không còn nháp');
  // DB trigger checks and locks the exact acceptance grant/user/participant
  // again. A later fresh grant cannot revive this immutable consent.
  if (
    await db.shipmentPlanAcceptance.findUnique({
      where: { planId_revision_party: { planId: id, revision, party } },
    })
  )
    throw new ConflictException('Bên này đã xác nhận; cần replay command cũ');
  const acceptance = await db.shipmentPlanAcceptance.create({
    data: {
      planId: id,
      revision,
      party,
      organizationId: actor.organizationId!,
      userId: actor.sub!,
      grantId: grant.id,
      grantRevision: grant.revision,
    },
  });
  await audit(
    db,
    actor,
    plan.chainId,
    'ACCEPT_SHIPMENT_PLAN',
    acceptance.id,
    revision,
  );
  return acceptance;
}

export async function cancelShipmentPlan(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  id: string,
  version: number,
) {
  const initial = await planBeforeLock(db, id);
  await lockContext(db, actor, initial.chainId, [
    initial.current.producerOrgId,
    initial.current.transporterOrgId,
    initial.current.retailerOrgId,
  ]);
  await authorizeBusinessCommand(
    db,
    actor,
    {
      chainId: initial.chainId,
      role: 'CHAIN_MANAGER',
      subject: { kind: 'lot', id: initial.lotId },
    },
    true,
  );
  const plan = await lockedPlan(db, id, version);
  await lockAggregate(db, 'lot', plan.lotId);
  const result = await db.shipmentPlan.update({
    where: { id },
    data: { status: 'CANCELLED', version: { increment: 1 } },
  });
  await audit(
    db,
    actor,
    plan.chainId,
    'CANCEL_SHIPMENT_PLAN',
    id,
    plan.currentRevision,
  );
  return result;
}
