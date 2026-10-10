import type { Contract, Network } from "@hyperledger/fabric-gateway";

import type { GatewayConfig } from "./config.js";

const decoder = new TextDecoder();

export interface TraceEventInput {
  eventId: string;
  entityType:
    | "PRODUCTION_CYCLE"
    | "CARE"
    | "SENSOR"
    | "SENSOR_DIGEST"
    | "HARVEST"
    | "LOT"
    | "SHIPMENT"
    | "SHIPMENT_TELEMETRY"
    | "INSPECTION"
    | "CERTIFICATE";
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
    authProofType:
      | "DIGITAL_SIGNATURE"
      | "SIGNED_ASSERTION"
      | "TOKEN_FINGERPRINT"
      | "DEVICE_SIGNATURE"
      | "SYSTEM_ASSERTION";
    actorAuthProof: string;
  };
  payloadMetadata?: Record<string, unknown>;
}

/** Public Fabric write envelope; the private v2 hash input stays in PostgreSQL. */
export type TraceEventEnvelope = Omit<
  TraceEventInput,
  "actorContext" | "payloadMetadata"
> & {
  envelopeVersion: "3.0.0";
  nonce: string;
};

export function serializeTraceEnvelope(input: TraceEventEnvelope): string {
  const keys = new Set([
    "envelopeVersion",
    "nonce",
    "eventId",
    "entityType",
    "entityId",
    "cycleId",
    "lotId",
    "eventType",
    "eventTime",
    "dataHash",
    "previousEventHash",
    "schemaVersion",
    "canonicalizationVersion",
  ]);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.has(key))
  )
    throw new Error("INVALID_INPUT: incompatible or private Fabric envelope");
  // Capture primitives once; never serialize caller-provided nested objects.
  const envelope = {
    envelopeVersion: input.envelopeVersion,
    nonce: input.nonce,
    eventId: input.eventId,
    entityType: input.entityType,
    entityId: input.entityId,
    cycleId: input.cycleId,
    lotId: input.lotId,
    eventType: input.eventType,
    eventTime: input.eventTime,
    dataHash: input.dataHash,
    previousEventHash: input.previousEventHash,
    schemaVersion: input.schemaVersion,
    canonicalizationVersion: input.canonicalizationVersion,
  };
  const uuid = (value: unknown) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    );
  const hash = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const time = envelope.eventTime;
  if (
    envelope.envelopeVersion !== "3.0.0" ||
    envelope.nonce !== envelope.eventId ||
    !uuid(envelope.eventId) ||
    !uuid(envelope.entityId) ||
    (envelope.cycleId !== undefined && !uuid(envelope.cycleId)) ||
    (envelope.lotId !== undefined && !uuid(envelope.lotId)) ||
    ![
      "PRODUCTION_CYCLE",
      "CARE",
      "SENSOR",
      "SENSOR_DIGEST",
      "HARVEST",
      "LOT",
      "SHIPMENT",
      "SHIPMENT_TELEMETRY",
      "INSPECTION",
      "CERTIFICATE",
    ].includes(envelope.entityType) ||
    typeof envelope.eventType !== "string" ||
    !/^[A-Z][A-Z0-9_]{1,99}$/.test(envelope.eventType) ||
    typeof time !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(time) ||
    !Number.isFinite(Date.parse(time)) ||
    new Date(time).toISOString().slice(0, 19) !== time.slice(0, 19) ||
    !hash(envelope.dataHash) ||
    (envelope.previousEventHash !== undefined &&
      !hash(envelope.previousEventHash)) ||
    envelope.schemaVersion !== "2.0.0" ||
    envelope.canonicalizationVersion !== "RFC8785"
  )
    throw new Error("INVALID_INPUT: incompatible or private Fabric envelope");
  return JSON.stringify(envelope);
}

export class FabricBlockchainAdapter {
  private readonly network: Network;
  private readonly contract: Contract;

  public constructor(
    gateway: { getNetwork(channelName: string): Network },
    config: GatewayConfig,
  ) {
    this.network = gateway.getNetwork(config.channelName);
    this.contract = this.network.getContract(
      config.chaincodeName,
      config.contractName,
    );
  }

  public async submitTraceEvent(input: TraceEventEnvelope): Promise<unknown> {
    return this.decode(
      await this.contract.submitTransaction(
        "RecordTraceEvent",
        serializeTraceEnvelope(input),
      ),
    );
  }

  public async queryEvent(eventId: string): Promise<unknown> {
    return this.decode(
      await this.contract.evaluateTransaction("QueryEvent", eventId),
    );
  }

  public async getProof(eventId: string): Promise<unknown> {
    return this.decode(
      await this.contract.evaluateTransaction("GetProof", eventId),
    );
  }

  public async getExpectedHash(eventId: string): Promise<string> {
    return decoder.decode(
      await this.contract.evaluateTransaction("GetExpectedHash", eventId),
    );
  }

  public async queryEntityHistory(
    entityType: TraceEventInput["entityType"],
    entityId: string,
  ): Promise<unknown> {
    return this.decode(
      await this.contract.evaluateTransaction(
        "QueryEntityHistory",
        entityType,
        entityId,
      ),
    );
  }

  public async queryEntityHistoryPage(
    entityType: TraceEventInput["entityType"],
    entityId: string,
    pageSize = 100,
    bookmark = "",
  ): Promise<unknown> {
    return this.decode(
      await this.contract.evaluateTransaction(
        "QueryEntityHistoryPage",
        entityType,
        entityId,
        String(pageSize),
        bookmark,
      ),
    );
  }

  public async getEntityHead(
    entityType: TraceEventInput["entityType"],
    entityId: string,
  ): Promise<unknown> {
    return this.decode(
      await this.contract.evaluateTransaction(
        "GetEntityHead",
        entityType,
        entityId,
      ),
    );
  }

  public async healthCheck(): Promise<unknown> {
    return this.decode(await this.contract.evaluateTransaction("HealthCheck"));
  }

  private decode(bytes: Uint8Array): unknown {
    return JSON.parse(decoder.decode(bytes));
  }
}
