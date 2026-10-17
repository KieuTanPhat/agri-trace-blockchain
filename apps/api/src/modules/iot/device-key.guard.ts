import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { DeviceAuthentication } from '../../common/idempotency/command-authorization.js';
import { matchesDeviceCredential } from './device-credential.js';

export interface DeviceAuthenticatedRequest extends Request {
  deviceAuthentication?: DeviceAuthentication;
}

@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<DeviceAuthenticatedRequest>();
    const body: unknown = request.body;
    const deviceId =
      body && typeof body === 'object' && 'deviceId' in body
        ? body.deviceId
        : null;
    const token = request.header('x-device-key') ?? '';
    const credentialId = token.split('.')[0];
    if (
      typeof deviceId !== 'string' ||
      !isUUID(deviceId) ||
      !isUUID(credentialId) ||
      token.length > 123
    )
      throw new UnauthorizedException('Device key không hợp lệ');
    const credential = await this.prisma.deviceCredential.findUnique({
      where: { id: credentialId },
    });
    if (
      !credential ||
      !matchesDeviceCredential(token, deviceId, credential, new Date())
    ) {
      throw new UnauthorizedException('Device key không hợp lệ');
    }
    request.deviceAuthentication = {
      deviceId,
      credentialId: credential.id,
      revision: credential.revision,
      verifier: credential.verifier,
    };
    return true;
  }
}
