import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { TraceController } from './trace.controller.js';
import { TraceService } from './trace.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TraceController],
  providers: [TraceService],
  exports: [TraceService],
})
export class TraceModule {}
