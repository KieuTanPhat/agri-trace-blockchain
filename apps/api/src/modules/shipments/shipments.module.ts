import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { HandoversController } from './handovers.controller.js';
import { HandoversService } from './handovers.service.js';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsService } from './shipments.service.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [ShipmentsController, HandoversController],
  providers: [ShipmentsService, HandoversService],
  exports: [ShipmentsService, HandoversService],
})
export class ShipmentsModule {}
