import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { IdempotencyService } from './idempotency.service.js';

@Module({
  imports: [PrismaModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}