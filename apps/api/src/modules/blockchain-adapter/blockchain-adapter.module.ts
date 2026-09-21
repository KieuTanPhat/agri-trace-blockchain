import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { BlockchainController } from './blockchain.controller.js';
import { BlockchainProofQueryService } from './blockchain-proof-query.service.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [BlockchainController],
  providers: [BlockchainProofQueryService],
  exports: [BlockchainProofQueryService],
})
export class BlockchainAdapterModule {}
