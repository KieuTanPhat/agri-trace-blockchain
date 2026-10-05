import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
