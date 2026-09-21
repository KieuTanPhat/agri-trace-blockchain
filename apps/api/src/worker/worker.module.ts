import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BlockchainWorkerRunner } from '../modules/blockchain-adapter/blockchain-worker.runner.js';
import { BlockchainWorkerService } from '../modules/blockchain-adapter/blockchain-worker.service.js';
import { FabricAdapterProvider } from '../modules/blockchain-adapter/fabric-adapter.provider.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkerHealthController } from './worker-health.controller.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [WorkerHealthController],
  providers: [
    FabricAdapterProvider,
    BlockchainWorkerService,
    BlockchainWorkerRunner,
  ],
})
export class WorkerModule {}
