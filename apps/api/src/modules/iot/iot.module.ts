import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { DeviceKeyGuard } from './device-key.guard.js';
import { IotController } from './iot.controller.js';
import { IotService } from './iot.service.js';
import { DevicesController } from './devices.controller.js';
import { DeviceRegistryService } from './device-registry.service.js';
import { DeviceIngestService } from './device-ingest.service.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [IotController, DevicesController],
  providers: [IotService, DeviceKeyGuard, DeviceRegistryService, DeviceIngestService],
})
export class IotModule {}
