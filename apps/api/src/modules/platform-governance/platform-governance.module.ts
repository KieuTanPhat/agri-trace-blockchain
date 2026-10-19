import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SupplyChainsModule } from '../supply-chains/supply-chains.module.js';
import { UsersModule } from '../users/users.module.js';
import {
  PlatformApprovalsController,
  PlatformAuditController,
  PlatformMfaController,
  PlatformOperationsController,
  PlatformCasesController,
  EnterpriseCasesController,
} from './platform-governance.controller.js';
import { PlatformCasesService } from './platform-cases.service.js';
import {
  PlatformRecallController,
  PlatformRecallService,
} from './platform-recall.js';
import {
  PlatformPrivacyController,
  PlatformPrivacyService,
  PrivacyRequestsController,
} from './platform-privacy.js';
import { PlatformOperationsService } from './platform-operations.service.js';
import { PlatformApprovalsService } from './platform-approvals.service.js';
import { PlatformAuditService } from './platform-audit.service.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    IdempotencyModule,
    SupplyChainsModule,
    UsersModule,
  ],
  controllers: [
    PlatformAuditController,
    PlatformMfaController,
    PlatformApprovalsController,
    PlatformOperationsController,
    PlatformCasesController,
    EnterpriseCasesController,
    PlatformRecallController,
    PlatformPrivacyController,
    PrivacyRequestsController,
  ],
  providers: [
    PlatformAuditService,
    PlatformApprovalsService,
    PlatformOperationsService,
    PlatformCasesService,
    PlatformRecallService,
    PlatformPrivacyService,
  ],
})
export class PlatformGovernanceModule {}
