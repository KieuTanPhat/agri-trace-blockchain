import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PublicContentController } from './public-content.controller.js';
import { PublicContentService } from './public-content.service.js';
import { NewsImageService } from './news-image.service.js';
import { NEWS_IMAGE_FETCH, downloadNewsImage } from './news-image.js';
import { AdminNewsController } from './admin-news.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
@Module({
  imports: [PrismaModule, ConfigModule, AuthModule, IdempotencyModule],
  controllers: [PublicContentController, AdminNewsController],
  providers: [
    PublicContentService,
    NewsImageService,
    { provide: NEWS_IMAGE_FETCH, useValue: downloadNewsImage },
  ],
})
export class PublicContentModule {}
