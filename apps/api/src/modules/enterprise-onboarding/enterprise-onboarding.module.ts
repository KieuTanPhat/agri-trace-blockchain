import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { EnterpriseOnboardingController } from './enterprise-onboarding.controller.js';
import { EnterpriseOnboardingService } from './enterprise-onboarding.service.js';
import { EnterpriseServiceService } from './enterprise-service.service.js';
import {
  EnterpriseReferenceController,
  EnterpriseServiceController,
} from './enterprise-service.controller.js';
import { RegistrationOtpService } from './registration-otp.service.js';
import { RegistrationOtpController } from './registration-otp.controller.js';
import {
  RegistrationDocumentUploadController,
  RegistrationDocumentReadController,
} from './registration-documents.js';
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [
    EnterpriseOnboardingController,
    EnterpriseReferenceController,
    EnterpriseServiceController,
    RegistrationOtpController,
    RegistrationDocumentUploadController,
    RegistrationDocumentReadController,
  ],
  providers: [
    EnterpriseOnboardingService,
    EnterpriseServiceService,
    RegistrationOtpService,
  ],
})
export class EnterpriseOnboardingModule {}
