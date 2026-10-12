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
import { legacyCreationReplayRoot } from './legacy-creation-replay.js';
import { legacyCycleHasCutover } from './legacy-cutover-policy.js';

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

/** `null` means the subject is legacy and keeps the original policy. A scoped
 * subject never falls back to a global role or organization-only authority. */
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
  if (['CREATE_PRODUCTION_CYCLE', 'CREATE_SHIPMENT'].includes(operation)) {
    const replay = await legacyCreationReplayRoot(db, input);
    if (replay)
      return authorizeBusinessCommand(
        db,
        actor,
        {
          chainId: replay.cycle.chainId!,
          role: 'FARM_STAFF',
          subject: { kind: 'cycle', id: replay.cycle.id },
        },
        lock,
      );
  }
  if (operation === 'CREATE_PRODUCTION_CYCLE') {
    if (!data.chainId) {
      if (
        actor.organizationId &&
        (await db.organizationBusinessScope.findUnique({
          where: { organizationId: actor.organizationId },
        }))
      )
        throw new ForbiddenException('Tạo vụ sau cutover cần chọn chuỗi');
      return null;
    }
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
  if (CYCLE_WRITES.includes(operation)) {
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
  if (!root.cycle.chainId) {
    if (await legacyCycleHasCutover(db, root.cycle.id, actor.organizationId))
      throw new ForbiddenException(
        'Subject legacy chưa mapping chuỗi; cần đối soát trước khi ghi',
      );
    if (operation === 'CREATE_SHIPMENT') {
      const party = await db.organizationBusinessScope.findFirst({
        where: {
          organizationId: { in: [id('transporterOrgId'), id('retailerOrgId')] },
        },
      });
      if (party)
        throw new ForbiddenException(
          'Bên nhận đã cutover; Shipment cần mapping chuỗi và consent',
        );
    }
    return null;
  }
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
    const device = await db.iotDevice.findFirst({
      where: isUUID(value)
        ? { OR: [{ id: value }, { deviceCode: value }] }
        : { deviceCode: value },
    });
    if (
      !device ||
      device.status !== 'ACTIVE' ||
      device.organizationId !== actor.organizationId ||
      (operation === 'INGEST_SENSOR_READING' &&
        device.cycleId !== root.cycle.id)
    )
      throw new ForbiddenException('Thiết bị không thuộc scope command');
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
  if (!chainId) {
    if (await legacyCycleHasCutover(db, root.cycle.id, organizationId))
      throw new ForbiddenException(
        'Thiết bị legacy chưa resolve scope sau cutover',
      );
    return null;
  }
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
