import { ForbiddenException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import type {
  AuthorizedCommand,
  CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  lockChainScope,
  organizationGrant,
} from '../supply-chains/chain-policy.js';

export const DEVICE_ASSET_OPERATIONS = [
  'IOT_REGISTER_DEVICE',
  'IOT_DEVICE_STATUS',
  'IOT_ISSUE_CREDENTIAL',
  'IOT_ROTATE_CREDENTIAL',
  'IOT_REVOKE_CREDENTIAL',
] as const;

export async function deviceAssetAuthority(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  lock = false,
) {
  if (
    !actor.sub ||
    !actor.organizationId ||
    ['SYSTEM_ADMIN', 'AUDITOR'].includes(actor.role)
  )
    throw new ForbiddenException('Cần ORG_ADMIN của doanh nghiệp vận chuyển');
  if (lock) await lockChainScope(db, `org:${actor.organizationId}`);
  const grant = await organizationGrant(db, actor, 'ORG_ADMIN');
  const organization = await db.organization.findUnique({
    where: { id: actor.organizationId },
    include: {
      enterpriseEnrollment: true,
      capabilities: { where: { code: 'TRANSPORTER', revokedAt: null } },
    },
  });
  if (
    !grant ||
    organization?.status !== 'ACTIVE' ||
    !organization.capabilities.length ||
    organization.enterpriseEnrollment?.status !== 'APPROVED'
  )
    throw new ForbiddenException(
      'Doanh nghiệp chưa được duyệt hoặc quyền quản lý thiết bị đã thu hồi',
    );
  return { grant, capability: organization.capabilities[0] };
}

export async function authorizeDeviceAssetCommand(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
  lock: boolean,
) {
  if (
    !DEVICE_ASSET_OPERATIONS.some((op) => op === input.operation) ||
    !input.actor
  )
    throw new ForbiddenException('Command thiết bị không hợp lệ');
  const actor = input.actor;
  const authority = await deviceAssetAuthority(db, actor, lock);
  const payload = input.payload as Record<string, unknown>;
  if (input.operation !== 'IOT_REGISTER_DEVICE') {
    if (typeof payload.deviceId !== 'string' || !isUUID(payload.deviceId))
      throw new ForbiddenException('Định danh thiết bị không hợp lệ');
    if (lock)
      await db.$queryRaw`SELECT device_id FROM iot_device WHERE device_id=${payload.deviceId}::uuid FOR UPDATE`;
    const device = await db.iotDevice.findUnique({
      where: { id: payload.deviceId },
    });
    if (!device || device.organizationId !== actor.organizationId)
      throw new ForbiddenException('Thiết bị nằm ngoài phạm vi tổ chức');
  }
  // Exclude resource version: the original committed mutation changes it.
  return canonicalSha256({
    protocol: 'iot-asset-v1',
    requesterId: actor.sub,
    organizationId: actor.organizationId,
    grantId: authority.grant.id,
    grantRevision: authority.grant.revision,
    capabilityRevision: authority.capability.revision,
  });
}
