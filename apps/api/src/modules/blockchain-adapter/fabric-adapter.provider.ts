import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  FabricBlockchainAdapter,
  connectGateway,
  loadConfig,
  type GatewayConnection,
} from '@agri-trace/fabric-gateway';

@Injectable()
export class FabricAdapterProvider implements OnModuleDestroy {
  private connection?: GatewayConnection;
  private adapter?: FabricBlockchainAdapter;

  async getAdapter(): Promise<FabricBlockchainAdapter> {
    if (this.adapter) return this.adapter;
    const config = loadConfig();
    this.connection = await connectGateway(config);
    this.adapter = new FabricBlockchainAdapter(this.connection.gateway, config);
    return this.adapter;
  }

  onModuleDestroy(): void {
    this.connection?.close();
  }
}
