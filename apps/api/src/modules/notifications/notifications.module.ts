import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AlertScannerService } from './alert-scanner.service.js';
import {
  AlertRulesController,
  NotificationsController,
} from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [NotificationsController, AlertRulesController],
  providers: [NotificationsService, AlertScannerService],
  exports: [NotificationsService, AlertScannerService],
})
export class NotificationsModule {}
