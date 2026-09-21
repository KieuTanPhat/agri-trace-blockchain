import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-device-key') ?? '';
    const expected = this.config.get<string>('IOT_INGEST_API_KEY') ?? '';
    if (!expected || supplied.length !== expected.length) {
      throw new UnauthorizedException('Device key không hợp lệ');
    }
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      throw new UnauthorizedException('Device key không hợp lệ');
    }
    return true;
  }
}
