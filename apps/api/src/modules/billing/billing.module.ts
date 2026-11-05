import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import {
  EnterpriseBillingController,
  PlatformBillingController,
} from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { SepayController } from './sepay.controller.js';
import { SepayService } from './sepay.service.js';

@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [PlatformBillingController, EnterpriseBillingController, SepayController],
  providers: [BillingService, SepayService],
})
export class BillingModule {}
