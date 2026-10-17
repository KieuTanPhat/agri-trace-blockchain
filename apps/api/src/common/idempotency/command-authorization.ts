import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { canonicalSha256 } from '../crypto/rfc8785.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { sessionFamilyWhere } from '../../modules/auth/session-family.js';
import { authorizeChainCommand } from '../../modules/supply-chains/chain-policy.js';
import {
  SHIPMENT_PLAN_OPERATIONS,
  authorizeShipmentPlanCommand,
  lockShipmentPlanCommand,
} from '../../modules/supply-chains/shipment-plan.commands.js';
import {
  authorizeCoreBusinessCommand,
  scopedDeviceAuthority,
} from '../../modules/supply-chains/core-business-policy.js';
import { lockChainScope } from '../../modules/supply-chains/chain-policy.js';
import { authorizeEnterpriseCommand } from '../../modules/enterprise-onboarding/enterprise-onboarding.service.js';
import { DEVICE_ASSET_OPERATIONS, authorizeDeviceAssetCommand } from '../../modules/iot/device-assets.policy.js';

export interface CommandActor {
  sub: string | null;
  organizationId: string | null;
  role: string;
  sid?: string;
}

export interface AuthorizedCommand {
  deviceAuthentication?: DeviceAuthentication;
  requesterId: string;
  operation: string;
  payload: unknown;
  actor: CommandActor | null;
  businessActor?: CommandActor;
  idempotencyKey?: string;
}

export interface DeviceAuthentication {
  deviceId: string;
  credentialId: string;
  revision: number;
  verifier: string;
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
  const shipment = async (shipmentId: string) => {
    const found = await db.shipment.findUnique({ where: { id: shipmentId } });
    if (!found) throw new NotFoundException('Không tìm thấy chuyến vận chuyển');
    return found;
  };

  if (!input.actor) {
    const authenticated = input.deviceAuthentication;
    if (!authenticated || authenticated.deviceId !== payload.deviceId)
      throw new ForbiddenException('Thiếu credential đã xác thực của thiết bị');
    if (
      !['INGEST_SENSOR_READING', 'INGEST_SHIPMENT_TELEMETRY'].includes(
        input.operation,
      )
    )
      throw new ForbiddenException('Command yêu cầu đăng nhập');
    let found = await device();
    if (input.requesterId !== `device:${String(payload.deviceId)}`)
      throw new ForbiddenException('Device requester không hợp lệ');
    if (lock) {
      await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${found.organizationId}::uuid FOR SHARE`;
      const current = await device();
      if (current.organizationId !== found.organizationId)
        throw new ForbiddenException('Phạm vi thiết bị đã thay đổi');
    }
    const subject =
      input.operation === 'INGEST_SENSOR_READING'
        ? { kind: 'cycle' as const, id: id('cycleId') }
        : { kind: 'shipment' as const, id: id('shipmentId') };
    const deviceScope = await scopedDeviceAuthority(
      db,
      found.organizationId,
      subject,
      lock,
    );
    if (lock) {
      await db.$queryRaw`SELECT device_id FROM iot_device WHERE device_id=${found.id}::uuid FOR SHARE`;
      const current = await device();
      if (
        current.id !== found.id ||
        current.organizationId !== found.organizationId
      )
        throw new ForbiddenException('Phạm vi thiết bị đã thay đổi');
      found = current;
    }
    const credential = await db.deviceCredential.findUnique({ where: { id: authenticated.credentialId } });
    if (!credential || credential.deviceId !== found.id || credential.revokedAt !== null ||
        credential.expiresAt <= new Date() || credential.revision !== authenticated.revision ||
        credential.verifier !== authenticated.verifier)
      throw new ForbiddenException('Credential thiết bị không còn hiệu lực');
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
      if (lock)
        await db.$queryRaw`SELECT binding_id FROM shipment_tracking_binding WHERE shipment_id=${subject.id}::uuid AND device_id=${found.id}::uuid AND status='ACTIVE' AND unbound_at IS NULL FOR SHARE`;
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
      authorityRevision: found.authorityRevision,
      protocol: 'scoped-device-v1',
      deviceScope,
    });
  }

  const actor = input.actor;
  if (!actor.sub || actor.sub !== input.requesterId || !isUUID(actor.sub))
    throw new UnauthorizedException('Command thiếu định danh hợp lệ');
  if (lock) {
    if (
      SHIPMENT_PLAN_OPERATIONS.some(
        (operation) => operation === input.operation,
      )
    ) {
      await lockShipmentPlanCommand(db, input);
    } else {
      // Same organization -> user order as refresh/logout. Shared locks allow
      // concurrent business commands but serialize account/org revocation.
      if (actor.organizationId)
        await db.$queryRaw`SELECT organization_id FROM organization WHERE organization_id = ${actor.organizationId}::uuid FOR SHARE`;
      await db.$queryRaw`SELECT user_id FROM app_user WHERE user_id = ${actor.sub}::uuid FOR SHARE`;
    }
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

  if (
    SHIPMENT_PLAN_OPERATIONS.some((operation) => operation === input.operation)
  )
    return authorizeShipmentPlanCommand(db, input, lock);
  if (input.operation.startsWith('HYB_'))
    return authorizeChainCommand(db, input, lock);
  if (input.operation.startsWith('ENTERPRISE_'))
    return authorizeEnterpriseCommand(db,input,lock);
  if (DEVICE_ASSET_OPERATIONS.some((op) => op === input.operation))
    return authorizeDeviceAssetCommand(db, input, lock);

  if (lock && actor.organizationId)
    await lockChainScope(db, `org:${actor.organizationId}`);
  const business = await authorizeCoreBusinessCommand(db, input, lock);
  if (business) {
    input.businessActor = business.actor;
    return business.scope;
  }
  input.businessActor = undefined;

  // Only platform administration and organization-level device registration
  // remain outside chain scope. Business commands never reach this point.
  switch (input.operation) {
    case 'CREATE_PRODUCT':
    case 'CREATE_FARM':
    case 'CREATE_PLOT':
    case 'CREATE_USERS':
    case 'CREATE_ORGANIZATIONS':
    case 'GRANT_COMPLIANCE_ASSIGNMENT':
    case 'REVOKE_COMPLIANCE_ASSIGNMENT':
      requireRole(actor, ['SYSTEM_ADMIN']);
      break;
    case 'CREATE_IOT_DEVICE':
      requireRole(actor, ['SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER']);
      if (actor.role !== 'SYSTEM_ADMIN')
        requireOwner(actor.organizationId, id('organizationId'));
      break;
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
