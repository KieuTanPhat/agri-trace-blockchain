import type { Contract, Network } from "@hyperledger/fabric-gateway";

import type { GatewayConfig } from "./config.js";

const decoder = new TextDecoder();

export interface TraceEventInput {
  eventId: string;
  entityType: "PRODUCTION_CYCLE" | "CARE" | "SENSOR" | "SENSOR_DIGEST" | "HARVEST" | "LOT" | "SHIPMENT" | "SHIPMENT_TELEMETRY" | "INSPECTION" | "CERTIFICATE";
  entityId: string;
  cycleId?: string;
  lotId?: string;
  eventType: string;
  eventTime: string;
  dataHash: string;
  previousEventHash?: string;
  schemaVersion: "2.0.0";
  canonicalizationVersion: "RFC8785";
  actorContext: {
    actorUserId?: string;
    organizationId?: string;
    role: string;
    authProofType: "DIGITAL_SIGNATURE" | "SIGNED_ASSERTION" | "TOKEN_FINGERPRINT" | "DEVICE_SIGNATURE" | "SYSTEM_ASSERTION";
    actorAuthProof: string;
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

  public async queryEntityHistory(entityType: TraceEventInput["entityType"], entityId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("QueryEntityHistory", entityType, entityId));
  }

  public async queryEntityHistoryPage(
    entityType: TraceEventInput["entityType"],
    entityId: string,
    pageSize = 100,
    bookmark = ""
  ): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction(
      "QueryEntityHistoryPage",
      entityType,
      entityId,
      String(pageSize),
      bookmark
    ));
  }

  public async getEntityHead(entityType: TraceEventInput["entityType"], entityId: string): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("GetEntityHead", entityType, entityId));
  }

  public async healthCheck(): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("HealthCheck"));
  }

  private decode(bytes: Uint8Array): unknown {
    return JSON.parse(decoder.decode(bytes));
  }
}
