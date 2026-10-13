import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyService } from './idempotency.service.js';
import { AuthModule } from '../../modules/auth/auth.module.js';
import { CommandRequestsController } from './command-requests.controller.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CommandRequestsController],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
