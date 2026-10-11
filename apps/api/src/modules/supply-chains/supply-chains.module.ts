import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { SupplyChainsController } from './supply-chains.controller.js';
import { SupplyChainsService } from './supply-chains.service.js';

@Module({
  imports: [AuthModule, PrismaModule, IdempotencyModule],
  controllers: [SupplyChainsController],
  providers: [SupplyChainsService],
})
export class SupplyChainsModule {}
