import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController, PublicMediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [MediaController, PublicMediaController],
  providers: [MediaService],
})
export class MediaModule {}
