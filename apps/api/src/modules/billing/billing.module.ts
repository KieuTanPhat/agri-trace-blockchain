import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  EnterpriseBillingController,
  PlatformBillingController,
} from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [PlatformBillingController, EnterpriseBillingController],
  providers: [BillingService],
})
export class BillingModule {}
