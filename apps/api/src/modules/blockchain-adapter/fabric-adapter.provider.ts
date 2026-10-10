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
  private connecting?: Promise<FabricBlockchainAdapter>;

  async getAdapter(): Promise<FabricBlockchainAdapter> {
    if (this.adapter) return this.adapter;
    if (this.connecting) return this.connecting;
    this.connecting = this.connectCompatibleAdapter();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  private async connectCompatibleAdapter(): Promise<FabricBlockchainAdapter> {
    const config = loadConfig();
    const connection = await connectGateway(config);
    const adapter = new FabricBlockchainAdapter(connection.gateway, config);
    try {
      const health = (await adapter.healthCheck()) as {
        status?: string;
        envelopeVersion?: string;
      };
      if (health.status !== 'OK' || health.envelopeVersion !== '3.0.0')
        throw new Error(
          'Fabric writer paused: chaincode must support envelope 3.0.0',
        );
    } catch (error) {
      connection.close();
      throw error;
    }
    this.connection = connection;
    this.adapter = adapter;
    return this.adapter;
  }

  onModuleDestroy(): void {
    this.connection?.close();
  }
}
