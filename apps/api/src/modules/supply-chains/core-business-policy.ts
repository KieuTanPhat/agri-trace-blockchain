import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedCommand } from '../../common/idempotency/command-authorization.js';
import {
  CUSTODY_EVENT_SELECT,
  resolveLotCustodian,
} from '../lots/lot-custody.js';
import {
  authorizeBusinessCommand,
  businessRoot,
  type BusinessRole,
  type BusinessSubject,
} from './business-policy.js';
import { lockChainScope } from './chain-policy.js';

const CYCLE_WRITES = [
  'PLANT_PRODUCTION_CYCLE',
  'RECORD_CARE',
  'RECORD_SENSOR',
  'CLOSE_PRODUCTION_CYCLE',
  'CANCEL_PRODUCTION_CYCLE',
  'RECORD_HARVEST',
  'CREATE_SENSOR_DIGEST',
  'RECONCILE_CYCLE_SENSOR',
  'INGEST_SENSOR_READING',
];
const LOT_WRITES = [
  'CREATE_SHIPMENT',
  'DAMAGE_LOT',
  'MARK_FOR_SALE',
  'MARK_SOLD',
  'RECALL_LOT',
  'EXPIRE_LOT',
  'CREATE_INSPECTION',
];
/** Two-party handover (release C). The acting role comes from the persisted
 * intent or handover, never from the request body. */
const HANDOVER_WRITES = [
  'PREPARE_HANDOVER_OFFER',
  'PREPARE_HANDOVER_CONFIRM',
  'SUBMIT_SIGNED_INTENT',
  'REJECT_HANDOVER',
  'CANCEL_HANDOVER',
];
const SHIPMENT_WRITES = [
  'START_SHIPMENT',
  'ARRIVE_SHIPMENT',
  'RECEIVE_SHIPMENT',
  'REJECT_SHIPMENT',
  'DAMAGE_SHIPMENT',
  'INGEST_SHIPMENT_TELEMETRY',
  'BIND_SHIPMENT_DEVICE',
  'UNBIND_SHIPMENT_DEVICE',
  'CREATE_SHIPMENT_TELEMETRY_DIGEST',
];

async function handoverTarget(
  db: Prisma.TransactionClient,
  operation: string,
  data: Record<string, unknown>,
  id: (field: string) => string,
): Promise<{ shipmentId: string; role: BusinessRole }> {
  const roleOf = (kind: string, side: 'giver' | 'receiver'): BusinessRole =>
    kind === 'PICKUP'
      ? side === 'giver'
        ? 'FARM_STAFF'
        : 'TRANSPORTER'
      : side === 'giver'
        ? 'TRANSPORTER'
        : 'RETAILER';
  if (operation === 'PREPARE_HANDOVER_OFFER') {
    const kind = String(data.kind);
    if (kind !== 'PICKUP' && kind !== 'ARRIVAL')
      throw new ForbiddenException('Loại bàn giao không hợp lệ');
    return { shipmentId: id('shipmentId'), role: roleOf(kind, 'giver') };
  }
  if (operation === 'SUBMIT_SIGNED_INTENT') {
    const intent = await db.signingIntent.findUnique({
      where: { id: id('intentId') },
    });
    const payload = intent?.payload as Record<string, string> | undefined;
    if (!intent || intent.entityType !== 'SHIPMENT' || !payload?.kind)
      throw new NotFoundException('Không tìm thấy yêu cầu ký');
    return {
      shipmentId: intent.entityId,
      role: roleOf(
        payload.kind,
        intent.operation === 'HANDOVER_OFFER' ? 'giver' : 'receiver',
      ),
    };
  }
  const handover = await db.shipmentHandover.findUnique({
    where: { id: id('handoverId') },
  });
  if (!handover) throw new NotFoundException('Không tìm thấy bàn giao');
  return {
    shipmentId: handover.shipmentId,
    role: roleOf(
      handover.kind,
      ['REJECT_HANDOVER', 'PREPARE_HANDOVER_CONFIRM'].includes(operation)
        ? 'receiver'
        : 'giver',
    ),
  };
}

/** Business commands are always authorized inside the subject's chain.
 * `null` means the operation is not a business command (platform
 * administration); it never means a fallback to a global role. */
export async function authorizeCoreBusinessCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
) {
  const actor = input.actor!;
  const data = input.payload as Record<string, unknown>;
  const id = (field: string) => {
    const value = data[field];
    if (typeof value !== 'string' || !isUUID(value))
      throw new ForbiddenException(`Thiếu ${field} hợp lệ`);
    return value;
  };
  const operation = input.operation;
  if (operation === 'CREATE_PRODUCTION_CYCLE') {
    const farm = await db.farm.findUnique({ where: { id: id('farmId') } });
    if (
      !farm ||
      farm.status !== 'ACTIVE' ||
      farm.organizationId !== actor.organizationId
    )
      throw new ForbiddenException('Nông trại không thuộc tổ chức thực hiện');
    return authorizeBusinessCommand(
      db,
      actor,
      { chainId: id('chainId'), role: 'FARM_STAFF' },
      lock,
    );
  }
  let subject: BusinessSubject;
  let role: BusinessRole;
  if (HANDOVER_WRITES.includes(operation)) {
    const target = await handoverTarget(db, operation, data, id);
    subject = { kind: 'shipment', id: target.shipmentId };
    role = target.role;
  } else if (CYCLE_WRITES.includes(operation)) {
    subject = { kind: 'cycle', id: id('cycleId' in data ? 'cycleId' : 'id') };
    role =
      operation === 'RECONCILE_CYCLE_SENSOR'
        ? 'COMPLIANCE_REVIEWER'
        : 'FARM_STAFF';
  } else if (LOT_WRITES.includes(operation)) {
    subject = { kind: 'lot', id: id('lotId') };
    role =
      operation === 'CREATE_INSPECTION'
        ? 'COMPLIANCE_REVIEWER'
        : ['MARK_FOR_SALE', 'MARK_SOLD'].includes(operation)
          ? 'RETAILER'
          : 'FARM_STAFF';
  } else if (SHIPMENT_WRITES.includes(operation)) {
    subject = {
      kind: 'shipment',
      id: id('shipmentId' in data ? 'shipmentId' : 'id'),
    };
    role = ['RECEIVE_SHIPMENT', 'REJECT_SHIPMENT'].includes(operation)
      ? 'RETAILER'
      : 'TRANSPORTER';
  } else if (
    operation === 'CREATE_CERTIFICATE' ||
    operation === 'REVIEW_CERTIFICATE'
  ) {
    const certificate =
      operation === 'REVIEW_CERTIFICATE'
        ? await db.certificate.findUnique({ where: { id: id('id') } })
        : data;
    if (
      !certificate ||
      Boolean(certificate.lotId) === Boolean(certificate.cycleId)
    )
      throw new NotFoundException('Không tìm thấy subject chứng nhận hợp lệ');
    subject = certificate.lotId
      ? { kind: 'lot', id: String(certificate.lotId) }
      : { kind: 'cycle', id: String(certificate.cycleId) };
    role =
      operation === 'REVIEW_CERTIFICATE' ? 'COMPLIANCE_REVIEWER' : 'FARM_STAFF';
  } else if (operation === 'CREATE_IOT_DEVICE' && data.cycleId) {
    subject = { kind: 'cycle', id: id('cycleId') };
    role = 'FARM_STAFF';
    if (data.organizationId !== actor.organizationId)
      throw new ForbiddenException('Không đăng ký thiết bị thay tổ chức khác');
  } else return null;
  const root = await businessRoot(db, subject);
  if (operation === 'CREATE_SHIPMENT')
    throw new ForbiddenException('Lô thuộc chuỗi phải finalize ShipmentPlan');
  if (data.chainId && data.chainId !== root.cycle.chainId)
    throw new NotFoundException('Không tìm thấy subject trong chuỗi');
  if (['RECALL_LOT', 'EXPIRE_LOT', 'DAMAGE_SHIPMENT'].includes(operation)) {
    const lot = await db.lot.findUniqueOrThrow({
      where: { id: root.lotId! },
      include: { shipment: true, traceEvents: CUSTODY_EVENT_SELECT },
    });
    const custody = resolveLotCustodian(lot);
    if (!custody || custody.organizationId !== actor.organizationId)
      throw new ForbiddenException('Không xác định custody đúng tổ chức');
    role = custody.role;
  }
  const authority = await authorizeBusinessCommand(
    db,
    actor,
    { chainId: root.cycle.chainId, role, subject },
    lock,
  );
  if (
    [
      'INGEST_SENSOR_READING',
      'INGEST_SHIPMENT_TELEMETRY',
      'BIND_SHIPMENT_DEVICE',
      'UNBIND_SHIPMENT_DEVICE',
    ].includes(operation)
  ) {
    const value = data.deviceId;
    if (typeof value !== 'string')
      throw new ForbiddenException('Thiếu thiết bị');
    let device = await db.iotDevice.findFirst({
      where: isUUID(value)
        ? { OR: [{ id: value }, { deviceCode: value }] }
        : { deviceCode: value },
    });
    if (lock && device) {
      await db.$queryRaw`SELECT device_id FROM iot_device WHERE device_id=${device.id}::uuid FOR SHARE`;
      device = await db.iotDevice.findUnique({ where: { id: device.id } });
    }
    if (
      !device ||
      device.status !== 'ACTIVE' ||
      device.organizationId !== actor.organizationId ||
      (operation === 'INGEST_SENSOR_READING' &&
        device.cycleId !== root.cycle.id)
    )
      throw new ForbiddenException('Thiết bị không thuộc scope command');
    if (lock && operation === 'INGEST_SHIPMENT_TELEMETRY')
      await db.$queryRaw`SELECT binding_id FROM shipment_tracking_binding WHERE shipment_id=${root.shipmentId}::uuid AND device_id=${device.id}::uuid AND status='ACTIVE' AND unbound_at IS NULL FOR SHARE`;
    if (
      operation === 'INGEST_SHIPMENT_TELEMETRY' &&
      !(await db.shipmentTrackingBinding.findFirst({
        where: {
          shipmentId: root.shipmentId!,
          deviceId: device.id,
          status: 'ACTIVE',
          unboundAt: null,
        },
      }))
    )
      throw new ForbiddenException('Thiết bị chưa được phân công chuyến');
  }
  return authority;
}

/** Release A ingest authenticates an internal gateway, not an enterprise
 * signer. Its registered binding and current stage authority remain required. */
export async function scopedDeviceAuthority(
  db: Prisma.TransactionClient,
  organizationId: string,
  subject: BusinessSubject,
  lock: boolean,
) {
  const root = await businessRoot(db, subject);
  const chainId = root.cycle.chainId;
  if (lock) {
    await lockChainScope(db, `org:${organizationId}`);
    await lockChainScope(db, chainId);
    await db.$queryRaw`SELECT chain_id FROM chain_business_profile WHERE chain_id = ${chainId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT membership_id FROM chain_membership WHERE chain_id = ${chainId}::uuid AND organization_id = ${organizationId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT organization_id FROM organization_capability WHERE organization_id = ${organizationId}::uuid FOR SHARE`;
  }
  const profile = await db.chainBusinessProfile.findUnique({
    where: { chainId },
  });
  const member = await db.chainMembership.findUnique({
    where: { chainId_organizationId: { chainId, organizationId } },
  });
  const code = subject.kind === 'cycle' ? 'FARM' : 'TRANSPORTER';
  const capability = await db.organizationCapability.findUnique({
    where: { organizationId_code: { organizationId, code } },
  });
  const assigned = await db.stageAssignment.findFirst({
    where: {
      chainId,
      organizationId,
      status: 'ACCEPTED',
      ...(subject.kind === 'cycle'
        ? { stage: 'PRODUCTION', cycleId: root.cycle.id }
        : { stage: 'TRANSPORT', shipmentId: root.shipmentId }),
    },
  });
  if (
    profile?.state !== 'ACTIVE' ||
    profile.scopeVersion !== 1 ||
    member?.status !== 'ACTIVE' ||
    !capability ||
    capability.revokedAt ||
    !assigned
  )
    throw new ForbiddenException(
      'Thiết bị chưa có quyền trong chuỗi/công đoạn',
    );
  if (lock)
    await db.$queryRaw`SELECT assignment_id FROM stage_assignment WHERE assignment_id = ${assigned.id}::uuid FOR SHARE`;
  return {
    chainId,
    profileVersion: profile.version,
    membership: { id: member.id, version: member.version },
    capability: { code, revision: capability.revision },
    assignment: { id: assigned.id, version: assigned.version },
  };
}
