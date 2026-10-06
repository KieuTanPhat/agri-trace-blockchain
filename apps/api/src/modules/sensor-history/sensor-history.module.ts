import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SensorHistoryController } from './sensor-history.controller.js';
import { SensorHistoryService } from './sensor-history.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [SensorHistoryController],
  providers: [SensorHistoryService],
  exports: [SensorHistoryService],
})
export class SensorHistoryModule {}