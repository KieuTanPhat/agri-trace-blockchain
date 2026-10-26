import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { PublicDirectoryController } from './public-directory.controller.js';
import { PublicDirectoryService } from './public-directory.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [PublicDirectoryController],
  providers: [PublicDirectoryService],
})
export class PublicDirectoryModule {}
