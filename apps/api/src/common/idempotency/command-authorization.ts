import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../crypto/rfc8785.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { sessionFamilyWhere } from '../../modules/auth/session-family.js';

export interface CommandActor {
  sub: string | null;
  organizationId: string | null;
  role: string;
  sid?: string;
}

export interface AuthorizedCommand {
  requesterId: string;
  operation: string;
  payload: unknown;
  actor: CommandActor | null;
}

function payloadOf(input: AuthorizedCommand): Record<string, unknown> {
  if (
    !input.payload ||
    typeof input.payload !== 'object' ||
    Array.isArray(input.payload)
  )
    throw new ForbiddenException('Command payload không hợp lệ');
  return input.payload as Record<string, unknown>;
}

function requireRole(actor: CommandActor, roles: readonly string[]) {
  if (!roles.includes(actor.role))
    throw new ForbiddenException('Vai trò không được thực hiện command');
}

function requireOwner(actual: string | null, expected: string) {
  if (!actual || actual !== expected)
    throw new ForbiddenException('Command nằm ngoài phạm vi tổ chức');
}

/** Scope checks deliberately exclude lifecycle/version checks: a legitimate
 * replay remains valid after the original command advanced the resource. */
export async function authorizeCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock = false,
): Promise<string> {
  const payload = payloadOf(input);
  const id = (key: string) => {
    const value = payload[key];
    if (typeof value !== 'string' || !isUUID(value))
      throw new ForbiddenException(`Thiếu ${key} hợp lệ`);
    return value;
  };
  const device = async () => {
    const value = payload.deviceId;
    if (typeof value !== 'string')
      throw new ForbiddenException('Thiếu deviceId');
    const found = await db.iotDevice.findFirst({
      where: isUUID(value)
        ? { OR: [{ id: value }, { deviceCode: value }] }
        : { deviceCode: value },
      include: { organization: { select: { status: true } } },
    });
    if (
      !found ||
      found.status !== 'ACTIVE' ||
      found.organization.status !== 'ACTIVE'
    )
      throw new ForbiddenException('Thiết bị hoặc tổ chức không hoạt động');
    return found;
  };
  const cycle = async (cycleId: string) => {
    const found = await db.productionCycle.findUnique({
      where: { id: cycleId },
    });
    if (!found) throw new NotFoundException('Không tìm thấy vụ sản xuất');
    return found;
  };
  const lot = async (lotId: string) => {
    const found = await db.lot.findUnique({
      where: { id: lotId },
      include: { shipment: true, harvest: true },
    });
    if (!found) throw new NotFoundException('Không tìm thấy lô hàng');
    return found;
  };
  const shipment = async (shipmentId: string) => {
    const found = await db.shipment.findUnique({ where: { id: shipmentId } });
    if (!found) throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    return found;
  };

  if (!input.actor) {
    if (
      !['INGEST_SENSOR_READING', 'INGEST_SHIPMENT_TELEMETRY'].includes(
        input.operation,
      )
    )
      throw new ForbiddenException('Command yêu cầu đăng nhập');
    const found = await device();
    if (input.requesterId !== `device:${String(payload.deviceId)}`)
      throw new ForbiddenException('Device requester không hợp lệ');
    if (lock) {
      await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${found.organizationId}::uuid FOR SHARE`;
      const current = await device();
      if (current.organizationId !== found.organizationId)
        throw new ForbiddenException('Phạm vi thiết bị đã thay đổi');
    }
    if (input.operation === 'INGEST_SENSOR_READING') {
      const subject = await cycle(id('cycleId'));
      if (
        found.cycleId !== subject.id ||
        found.organizationId !== subject.farmOrgId
      )
        throw new ForbiddenException('Thiết bị không thuộc vụ sản xuất');
    } else {
      const subject = await shipment(id('shipmentId'));
      requireOwner(found.organizationId, subject.transporterOrgId);
      const binding = await db.shipmentTrackingBinding.findFirst({
        where: {
          shipmentId: subject.id,
          deviceId: found.id,
          status: 'ACTIVE',
          unboundAt: null,
        },
      });
      if (!binding)
        throw new ForbiddenException(
          'Thiết bị không được phân công chuyến hàng',
        );
    }
    return canonicalSha256({
      requesterId: input.requesterId,
      deviceId: found.id,
      organizationId: found.organizationId,
    });
  }

  const actor = input.actor;
  if (!actor.sub || actor.sub !== input.requesterId || !isUUID(actor.sub))
    throw new UnauthorizedException('Command thiếu định danh hợp lệ');
  if (lock) {
    // Same organization -> user order as refresh/logout. Shared locks allow
    // concurrent business commands but serialize account/org revocation.
    if (actor.organizationId)
      await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${actor.organizationId}::uuid FOR SHARE`;
    await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${actor.sub}::uuid FOR SHARE`;
  }
  const user = await db.user.findUnique({
    where: { id: actor.sub },
    include: { role: true, organization: true },
  });
  if (
    !user ||
    user.accountStatus !== 'ACTIVE' ||
    (user.organizationId && user.organization?.status !== 'ACTIVE') ||
    user.role.code !== actor.role ||
    user.organizationId !== actor.organizationId
  )
    throw new UnauthorizedException('Quyền tài khoản đã thay đổi');
  if (
    !actor.sid ||
    !(await db.refreshSession.findFirst({
      where: {
        ...sessionFamilyWhere(actor.sid),
        userId: user.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    }))
  )
    throw new UnauthorizedException('Phiên đăng nhập không còn hợp lệ');

  switch (input.operation) {
    case 'CREATE_PRODUCT':
    case 'CREATE_FARM':
    case 'CREATE_PLOT':
    case 'CREATE_USERS':
    case 'CREATE_ORGANIZATIONS':
    case 'GRANT_COMPLIANCE_ASSIGNMENT':
    case 'REVOKE_COMPLIANCE_ASSIGNMENT':
    case 'RECONCILE_CYCLE_SENSOR':
      requireRole(actor, ['SYSTEM_ADMIN']);
      break;
    case 'CREATE_PRODUCTION_CYCLE': {
      requireRole(actor, ['FARM_STAFF']);
      const farm = await db.farm.findUnique({ where: { id: id('farmId') } });
      if (!farm || farm.status !== 'ACTIVE')
        throw new ForbiddenException('Nông trại không hoạt động');
      requireOwner(actor.organizationId, farm.organizationId);
      break;
    }
    case 'PLANT_PRODUCTION_CYCLE':
    case 'RECORD_CARE':
    case 'RECORD_SENSOR':
    case 'CLOSE_PRODUCTION_CYCLE':
    case 'CANCEL_PRODUCTION_CYCLE':
    case 'RECORD_HARVEST':
    case 'CREATE_SENSOR_DIGEST': {
      requireRole(actor, ['FARM_STAFF']);
      const subject = await cycle(id('cycleId' in payload ? 'cycleId' : 'id'));
      requireOwner(actor.organizationId, subject.farmOrgId);
      break;
    }
    case 'CREATE_SHIPMENT': {
      requireRole(actor, ['FARM_STAFF']);
      requireOwner(actor.organizationId, (await lot(id('lotId'))).farmOrgId);
      break;
    }
    case 'START_SHIPMENT':
    case 'ARRIVE_SHIPMENT':
    case 'RECEIVE_SHIPMENT':
    case 'REJECT_SHIPMENT':
    case 'DAMAGE_SHIPMENT': {
      const subject = await shipment(id('id'));
      const roles =
        input.operation === 'DAMAGE_SHIPMENT'
          ? ['TRANSPORTER', 'RETAILER']
          : ['RECEIVE_SHIPMENT', 'REJECT_SHIPMENT'].includes(input.operation)
            ? ['RETAILER']
            : ['TRANSPORTER'];
      requireRole(actor, roles);
      requireOwner(
        actor.organizationId,
        actor.role === 'TRANSPORTER'
          ? subject.transporterOrgId
          : subject.retailerOrgId,
      );
      break;
    }
    case 'CREATE_CERTIFICATE': {
      requireRole(actor, ['FARM_STAFF']);
      if (Boolean(payload.lotId) === Boolean(payload.cycleId))
        throw new ForbiddenException('Chứng nhận cần đúng một đối tượng');
      const owner = payload.lotId
        ? (await lot(id('lotId'))).farmOrgId
        : (await cycle(id('cycleId'))).farmOrgId;
      requireOwner(actor.organizationId, owner);
      break;
    }
    case 'CREATE_IOT_DEVICE':
      requireRole(actor, ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER']);
      if (actor.role !== 'SYSTEM_ADMIN')
        requireOwner(actor.organizationId, id('organizationId'));
      break;
    case 'INGEST_SENSOR_READING': {
      requireRole(actor, ['FARM_STAFF']);
      const found = await device();
      requireOwner(actor.organizationId, found.organizationId);
      const subject = await cycle(id('cycleId'));
      requireOwner(actor.organizationId, subject.farmOrgId);
      if (found.cycleId !== subject.id)
        throw new ForbiddenException('Thiết bị không thuộc vụ sản xuất');
      break;
    }
    case 'INGEST_SHIPMENT_TELEMETRY':
    case 'BIND_SHIPMENT_DEVICE':
    case 'UNBIND_SHIPMENT_DEVICE':
    case 'CREATE_SHIPMENT_TELEMETRY_DIGEST': {
      requireRole(actor, ['TRANSPORTER']);
      const subject = await shipment(id('shipmentId'));
      requireOwner(actor.organizationId, subject.transporterOrgId);
      if (input.operation !== 'CREATE_SHIPMENT_TELEMETRY_DIGEST')
        requireOwner(actor.organizationId, (await device()).organizationId);
      break;
    }
    default:
      // New commands must explicitly define scope before they can be replayed.
      throw new ForbiddenException('Command chưa có policy phân quyền');
  }
  return canonicalSha256({
    requesterId: actor.sub,
    role: actor.role,
    organizationId: actor.organizationId,
  });
}
