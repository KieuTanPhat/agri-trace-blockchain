import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { ProductionCyclesController } from './production-cycles.controller.js';
import { ProductionCyclesService } from './production-cycles.service.js';

@Module({
  imports: [PrismaModule, AuthModule, TraceModule, IdempotencyModule],
  controllers: [ProductionCyclesController],
  providers: [ProductionCyclesService],
  exports: [ProductionCyclesService],
})
export class ProductionCyclesModule {}
