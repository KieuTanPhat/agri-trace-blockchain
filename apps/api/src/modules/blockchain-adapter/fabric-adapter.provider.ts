import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  FabricBlockchainAdapter,
  connectGateway,
  loadConfig,
  type GatewayConnection,
  type GatewayConfig,
} from '@agri-trace/fabric-gateway';
import {
  ROUTE_PROTOCOL,
  ledgerRouteDigest,
  type RouteDefinition,
} from '../trace/ledger-route.js';

@Injectable()
export class FabricAdapterProvider implements OnModuleDestroy {
  private connection?: GatewayConnection;
  private adapter?: FabricBlockchainAdapter;
  private connecting?: Promise<FabricBlockchainAdapter>;
  private gatewayConfig?: GatewayConfig;
  private writerIdentity?: RouteDefinition;

  /** Capture the destination used by this connection, including cached adapters.
   * A changed process env cannot label an existing gateway as a new ledger. */
  getWriterRoute(): RouteDefinition {
    if (this.writerIdentity) return this.writerIdentity;
    const config = loadConfig();
    const route: RouteDefinition = {
      protocol: ROUTE_PROTOCOL,
      mode: 'WRITE',
      network: process.env.FABRIC_NETWORK_NAME ?? '',
      channelId: config.channelName,
      chaincodeName: config.chaincodeName,
      contractName: config.contractName,
      envelopeVersion: '3.0.0',
      writerAuthority: process.env.LEDGER_WRITER_AUTHORITY ?? '',
      writerMspId: config.mspId,
      writerRole: 'relayer',
    };
    ledgerRouteDigest(route);
    this.gatewayConfig = config;
    this.writerIdentity = Object.freeze(route);
    return this.writerIdentity;
  }

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
    this.getWriterRoute();
    const config = this.gatewayConfig!;
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
