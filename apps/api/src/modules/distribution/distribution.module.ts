import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceModule } from '../trace/trace.module.js';
import { DistributionController } from './distribution.controller.js';
import { DistributionService } from './distribution.service.js';
import { QrLabelsController, QrLabelsService } from './qr-labels.js';
import { QuarantineCasesController, QuarantineCasesService, SiteTransfersController, SiteTransfersService } from './site-transfers.js';
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule, TraceModule],
  controllers: [DistributionController, QrLabelsController, SiteTransfersController, QuarantineCasesController],
  providers: [DistributionService, QrLabelsService, SiteTransfersService, QuarantineCasesService],
})
export class DistributionModule {}
