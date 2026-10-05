import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  FabricBlockchainAdapter,
  connectGateway,
  loadConfig,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';
import type {
  BlockchainAdapter,
  BlockchainAdapterFactory,
} from '../../common/ports/blockchain.port.js';
import { FabricTraceAdapter } from './fabric-trace.adapter.js';

@Injectable()
export class FabricAdapterProvider
  implements BlockchainAdapterFactory, OnModuleDestroy
{
  private connection?: GatewayConnection;
  private adapter?: BlockchainAdapter;

  async getAdapter(): Promise<BlockchainAdapter> {
    if (this.adapter) return this.adapter;
    const config = loadConfig();
    this.connection = await connectGateway(config);
    this.adapter = new FabricTraceAdapter(
      new FabricBlockchainAdapter(this.connection.gateway, config),
    );
    return this.adapter;
  }

  onModuleDestroy(): void {
    this.connection?.close();
  }
}
