import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { EnterpriseOnboardingController } from './enterprise-onboarding.controller.js';
import { EnterpriseOnboardingService } from './enterprise-onboarding.service.js';
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [EnterpriseOnboardingController],
  providers: [EnterpriseOnboardingService],
})
export class EnterpriseOnboardingModule {}
