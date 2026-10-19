import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { EnterpriseWorkspaceController } from './enterprise-workspace.controller.js';
import { EnterpriseWorkspaceService } from './enterprise-workspace.service.js';
import { EnterpriseResourcesService } from './enterprise-resources.service.js';
import { EnterpriseResourcesController, PublicEvidenceController } from './enterprise-resources.controller.js';
import { TraceModule } from '../trace/trace.module.js';
import { MemberInvitationsService, MemberInvitationsController, AcceptMemberInvitationController } from './member-invitations.js';
import { EnterpriseMessagesController, EnterpriseMessagesService } from './enterprise-messages.js';
import { ProfileAmendmentsService, ProfileAmendmentsController, ProfileReviewController } from './profile-amendments.js';
import { OwnershipTransfersService, OwnershipTransfersController } from './ownership-transfers.js';
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule, TraceModule],
  controllers: [EnterpriseWorkspaceController, EnterpriseResourcesController, PublicEvidenceController,MemberInvitationsController,AcceptMemberInvitationController,ProfileAmendmentsController,ProfileReviewController,OwnershipTransfersController,EnterpriseMessagesController],
  providers: [EnterpriseWorkspaceService, EnterpriseResourcesService,MemberInvitationsService,ProfileAmendmentsService,OwnershipTransfersService,EnterpriseMessagesService],
})
export class EnterpriseWorkspaceModule {}
