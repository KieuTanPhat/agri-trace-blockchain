import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { SigningController } from './signing.controller.js';
import { SigningKeysService } from './signing-keys.service.js';

@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [SigningController],
  providers: [SigningKeysService],
  exports: [SigningKeysService],
})
export class SigningModule {}
