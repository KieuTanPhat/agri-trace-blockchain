import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BlockchainWorkerRunner } from '../modules/blockchain-adapter/blockchain-worker.runner.js';
import { BlockchainWorkerService } from '../modules/blockchain-adapter/blockchain-worker.service.js';
import { FabricAdapterProvider } from '../modules/blockchain-adapter/fabric-adapter.provider.js';
import { BindingConnectionPool } from '../modules/ledger/binding-pool.js';
import { BindingDeliveryService } from '../modules/ledger/binding-delivery.service.js';
import { LedgerControlService } from '../modules/ledger/ledger-control.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WorkerHealthController } from './worker-health.controller.js';
import { HandoverExpiryService } from '../modules/shipments/handover-expiry.service.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule],
  controllers: [WorkerHealthController],
  providers: [
    FabricAdapterProvider,
    BindingConnectionPool,
    BindingDeliveryService,
    LedgerControlService,
    HandoverExpiryService,
    BlockchainWorkerService,
    BlockchainWorkerRunner,
  ],
})
export class WorkerModule {}
