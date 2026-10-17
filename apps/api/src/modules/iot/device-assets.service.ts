import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  authorizeCommand,
  type CommandActor,
} from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { businessTimestamp } from '../../common/timestamp.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  authorizeDeviceAssetCommand,
  deviceAssetAuthority,
} from './device-assets.policy.js';
import type {
  DeviceStatusDto,
  IssueDeviceCredentialDto,
  RegisterTransportDeviceDto,
} from './device-assets.dto.js';

export const credentialMetadata = {
  id: true,
  deviceId: true,
  revision: true,
  createdAt: true,
  expiresAt: true,
  revokedAt: true,
} satisfies Prisma.DeviceCredentialSelect;

@Injectable()
export class DeviceAssetsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(actor: CommandActor) {
    return this.prisma.$transaction(async (tx) => {
      await authorizeCommand(
        tx,
        {
          actor,
          requesterId: actor.sub ?? '',
          operation: 'IOT_REGISTER_DEVICE',
          payload: {},
        },
        true,
      );
      return tx.iotDevice.findMany({
        where: { organizationId: actor.organizationId ?? '' },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 200,
      });
    });
  }
  async credentials(deviceId: string, actor: CommandActor) {
    return this.prisma.$transaction(async (tx) => {
      await authorizeCommand(
        tx,
        {
          actor,
          requesterId: actor.sub ?? '',
          operation: 'IOT_REVOKE_CREDENTIAL',
          payload: { deviceId },
        },
        true,
      );
      return tx.deviceCredential.findMany({
        where: { deviceId },
        select: credentialMetadata,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 200,
      });
    });
  }
  register(input: RegisterTransportDeviceDto, actor: CommandActor) {
    return commandTransaction(this.prisma, async (tx) => {
      await deviceAssetAuthority(tx, actor, true);
      return tx.iotDevice.create({
        data: {
          organizationId: actor.organizationId ?? '',
          deviceCode: input.deviceCode.trim(),
          name: input.name.trim(),
          type: 'DHT22',
          sourceType: input.sourceType,
        },
      });
    });
  }
  private async current(
    tx: Prisma.TransactionClient,
    deviceId: string,
    version: number,
    actor: CommandActor,
  ) {
    await authorizeDeviceAssetCommand(
      tx,
      {
        actor,
        requesterId: actor.sub ?? '',
        operation: 'IOT_DEVICE_STATUS',
        payload: { deviceId },
      },
      true,
    );
    const device = await tx.iotDevice.findUniqueOrThrow({
      where: { id: deviceId },
    });
    if (device.version !== version)
      throw new ConflictException('Phiên bản thiết bị đã thay đổi');
    return device;
  }
  status(deviceId: string, input: DeviceStatusDto, actor: CommandActor) {
    return commandTransaction(this.prisma, async (tx) => {
      await this.current(tx, deviceId, input.version, actor);
      return tx.iotDevice.update({
        where: { id: deviceId },
        data: {
          status: input.status,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    });
  }
  issue(
    deviceId: string,
    input: IssueDeviceCredentialDto,
    actor: CommandActor,
    rotate: boolean,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      const device = await this.current(tx, deviceId, input.version, actor);
      if (device.status !== 'ACTIVE')
        throw new ConflictException('Thiết bị đang ngừng hoạt động');
      const now = new Date();
      const expiresAt = businessTimestamp(input.expiresAt, 'Hạn credential', {
        allowFuture: true,
      });
      if (expiresAt <= now || expiresAt.getTime() > now.getTime() + 7200000)
        throw new UnprocessableEntityException(
          'Credential demo phải hết hạn trong vòng 2 giờ',
        );
      const active = await tx.deviceCredential.findFirst({
        where: { deviceId, revokedAt: null },
      });
      if (rotate ? !active : !!active)
        throw new ConflictException(
          rotate
            ? 'Chưa có credential để xoay'
            : 'Thiết bị đã có credential; cần xoay',
        );
      if (active)
        await tx.deviceCredential.update({
          where: { id: active.id },
          data: { revokedAt: now },
        });
      const credential = await tx.deviceCredential.create({
        data: {
          id: input.credentialId.toLowerCase(),
          deviceId,
          verifier: input.verifier,
          expiresAt,
        },
        select: credentialMetadata,
      });
      const updated = await tx.iotDevice.findUniqueOrThrow({
        where: { id: deviceId },
      });
      return {
        credential,
        deviceVersion: updated.version,
        authorityRevision: updated.authorityRevision,
      };
    });
  }
  revoke(
    deviceId: string,
    credentialId: string,
    version: number,
    actor: CommandActor,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await this.current(tx, deviceId, version, actor);
      const active = await tx.deviceCredential.findFirst({
        where: { id: credentialId, deviceId, revokedAt: null },
      });
      if (!active)
        throw new ConflictException(
          'Credential không hoạt động hoặc không thuộc thiết bị',
        );
      const credential = await tx.deviceCredential.update({
        where: { id: active.id },
        data: { revokedAt: new Date() },
        select: credentialMetadata,
      });
      const updated = await tx.iotDevice.findUniqueOrThrow({
        where: { id: deviceId },
      });
      return {
        credential,
        deviceVersion: updated.version,
        authorityRevision: updated.authorityRevision,
      };
    });
  }
}
