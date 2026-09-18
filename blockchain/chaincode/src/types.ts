export const SCHEMA_VERSION = "2.0.0" as const;
export const CANONICALIZATION_VERSION = "RFC8785" as const;

export const ENTITY_TYPES = [
  "PRODUCTION_CYCLE", "CARE", "SENSOR", "HARVEST",
  "LOT", "SHIPMENT", "INSPECTION", "CERTIFICATE"
] as const;

export const EVENT_TYPES = [
  "PRODUCTION_CYCLE_CREATED", "PLANTING_RECORDED", "CARE_RECORDED",
  "SENSOR_RECORDED", "HARVEST_RECORDED", "PRODUCTION_CYCLE_COMPLETED",
  "INSPECTION_RECORDED", "CERTIFICATE_ATTACHED", "SHIPMENT_CREATED",
  "TRANSPORT_STARTED", "TRANSPORT_ARRIVED", "PARTIAL_DAMAGE_RECORDED",
  "DAMAGE_RECORDED", "RETAIL_RECEIVED", "RETAIL_REJECTED",
  "MARKED_FOR_SALE", "LOT_SOLD", "RECALL_RECORDED", "LOT_EXPIRED",
  "ENTITY_CANCELLED", "CORRECTION_RECORDED"
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];
export type EventType = (typeof EVENT_TYPES)[number];

export interface ActorContext {
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
}

export interface TraceEventInput {
  eventId: string;
  entityType: EntityType;
  entityId: string;
  cycleId?: string;
  lotId?: string;
  eventType: EventType;
  eventTime: string;
  dataHash: string;
  previousEventHash?: string;
  schemaVersion: typeof SCHEMA_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  actorContext: ActorContext;
  payloadMetadata?: Record<string, unknown>;
}

export interface StoredTraceEvent extends TraceEventInput {
  docType: "traceEvent";
  txId: string;
  channelId: string;
  recordedAt: string;
  submitterMspId: string;
  submitterId: string;
}

export interface BlockchainProof {
  docType: "blockchainProof";
  eventId: string;
  entityType: EntityType;
  entityId: string;
  cycleId?: string;
  lotId?: string;
  eventType: EventType;
  eventTime: string;
  dataHash: string;
  previousEventHash?: string;
  schemaVersion: typeof SCHEMA_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  txId: string;
  channelId: string;
  recordedAt: string;
  submitterMspId: string;
  submitterId: string;
}

export interface EntityLedgerHead {
  docType: "entityHead";
  entityType: EntityType;
  entityId: string;
  eventCount: number;
  firstEventId: string;
  lastEventId: string;
  lastEventTime: string;
  lastDataHash: string;
  updatedAt: string;
}

export interface SubmitReceipt {
  status: "SUBMITTED";
  eventId: string;
  entityType: EntityType;
  entityId: string;
  dataHash: string;
  txId: string;
  recordedAt: string;
  submitterMspId: string;
}

export interface HealthResult {
  status: "OK";
  contract: "AgriTraceContract";
  schemaVersion: typeof SCHEMA_VERSION;
}
