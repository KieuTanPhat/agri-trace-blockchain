import type { Contract, Network } from "@hyperledger/fabric-gateway";

import type { GatewayConfig } from "./config.js";

const decoder = new TextDecoder();

export interface TraceEventInput {
  eventId: string;
  batchId: string;
  eventType: "BATCH_CREATED";
  eventTime: string;
  dataHash: string;
  schemaVersion: "1.0.0";
  canonicalizationVersion: "RFC8785";
  actorContext: {
    actorId: string;
    role: "FARM_STAFF";
    organizationId: string;
  };
  actorAuthProof: {
    proofType: "BACKEND_AUTH_CONTEXT";
    principalId: string;
    authenticatedAt: string;
    requestId: string;
    proofHash: string;
  };
  payloadMetadata?: Record<string, unknown>;
}

export class FabricBlockchainAdapter {
  private readonly network: Network;
  private readonly contract: Contract;

  public constructor(gateway: { getNetwork(channelName: string): Network }, config: GatewayConfig) {
    this.network = gateway.getNetwork(config.channelName);
    this.contract = this.network.getContract(config.chaincodeName, config.contractName);
  }

  public async submitTraceEvent(input: TraceEventInput): Promise<unknown> {
    return this.decode(await this.contract.submitTransaction("RecordTraceEvent", JSON.stringify(input)));
  }

  public async queryEvent(eventId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("QueryEvent", eventId));
  }

  public async getProof(eventId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("GetProof", eventId));
  }

  public async getExpectedHash(eventId: string): Promise<string> {
    return decoder.decode(await this.contract.evaluateTransaction("GetExpectedHash", eventId));
  }

  public async queryBatchHistory(batchId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("QueryBatchHistory", batchId));
  }

  public async getBatchState(batchId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("GetBatchState", batchId));
  }

  public async healthCheck(): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("HealthCheck"));
  }

  private decode(bytes: Uint8Array): unknown {
    return JSON.parse(decoder.decode(bytes));
  }
}
