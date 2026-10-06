import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ReportAccessService } from './report-access.service.js';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
  ],
  controllers: [
    ReportsController,
  ],
  providers: [
    ReportAccessService,
    ReportsService,
  ],
  exports: [
    ReportsService,
  ],
})
export class ReportsModule {}