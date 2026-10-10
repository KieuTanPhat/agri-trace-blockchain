import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { LotsController, PublicTraceController } from './lots.controller.js';
import { LotHarvestService } from './lot-harvest.service.js';
import { LotQueryService } from './lot-query.service.js';
import { LotCommandsService } from './lot-commands.service.js';
import { LotCommandsController } from './lot-commands.controller.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [LotsController, PublicTraceController, LotCommandsController],
  providers: [LotHarvestService, LotQueryService, LotCommandsService],
  exports: [LotHarvestService, LotQueryService],
})
export class LotsModule {}
