import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { SupplyChainsController } from './supply-chains.controller.js';
import { SupplyChainsService } from './supply-chains.service.js';
import { ShipmentPlansController } from './shipment-plans.controller.js';
import { ShipmentPlansService } from './shipment-plans.service.js';
import { TraceModule } from '../trace/trace.module.js';
import { LegacyScopeController } from './legacy-scope.controller.js';

@Module({
  imports: [AuthModule, PrismaModule, IdempotencyModule, TraceModule],
  controllers: [SupplyChainsController, ShipmentPlansController, LegacyScopeController],
  providers: [SupplyChainsService, ShipmentPlansService],
})
export class SupplyChainsModule {}
