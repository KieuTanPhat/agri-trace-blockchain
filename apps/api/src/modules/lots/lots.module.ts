import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { LotsController, PublicTraceController } from './lots.controller.js';
import { LotsService } from './lots.service.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [LotsController, PublicTraceController],
  providers: [LotsService],
  exports: [LotsService],
})
export class LotsModule {}
