import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { DeviceKeyGuard } from './device-key.guard.js';
import { IotController } from './iot.controller.js';
import { IotService } from './iot.service.js';
import { DeviceAssetsController } from './device-assets.controller.js';
import { DeviceAssetsService } from './device-assets.service.js';
import { DeviceCommandsController } from './device-commands.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [IotController, DeviceAssetsController, DeviceCommandsController],
  providers: [IotService, DeviceKeyGuard, DeviceAssetsService],
})
export class IotModule {}
