import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BlockchainController } from './blockchain.controller.js';
import { BlockchainWorkerService } from './blockchain-worker.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BlockchainController],
  providers: [BlockchainWorkerService],
  exports: [BlockchainWorkerService],
})
export class BlockchainAdapterModule {}
