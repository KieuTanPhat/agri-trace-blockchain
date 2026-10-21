import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminInsightsService } from './admin-insights.service.js';
import {
  EnterpriseSupportController,
  PlatformAdminController,
  PublicReportsController,
  ReferenceItemsController,
  SystemNoticesController,
} from './platform-admin.controller.js';
import { SupportService } from './support.service.js';

@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [
    PlatformAdminController,
    EnterpriseSupportController,
    SystemNoticesController,
    ReferenceItemsController,
    PublicReportsController,
  ],
  providers: [AdminInsightsService, SupportService],
})
export class PlatformAdminModule {}
