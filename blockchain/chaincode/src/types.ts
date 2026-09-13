export const SCHEMA_VERSION = "1.0.0" as const;
export const CANONICALIZATION_VERSION = "RFC8785" as const;
export const SUPPORTED_EVENT_TYPE = "BATCH_CREATED" as const;
export const INITIAL_BATCH_STATE = "CREATED" as const;

export interface ActorContext {
  actorId: string;
  role: "FARM_STAFF";
  organizationId: string;
}

export interface ActorAuthProof {
  proofType: "BACKEND_AUTH_CONTEXT";
  principalId: string;
  authenticatedAt: string;
  requestId: string;
  proofHash: string;
}

export interface TraceEventInput {
  eventId: string;
  batchId: string;
  eventType: typeof SUPPORTED_EVENT_TYPE;
  eventTime: string;
  dataHash: string;
  schemaVersion: typeof SCHEMA_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  actorContext: ActorContext;
  actorAuthProof: ActorAuthProof;
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
  batchId: string;
  dataHash: string;
  schemaVersion: typeof SCHEMA_VERSION;
  canonicalizationVersion: typeof CANONICALIZATION_VERSION;
  txId: string;
  channelId: string;
  recordedAt: string;
  submitterMspId: string;
  submitterId: string;
}

export interface BatchLedgerState {
  docType: "batchState";
  batchId: string;
  currentState: typeof INITIAL_BATCH_STATE;
  eventCount: number;
  createdEventId: string;
  lastEventId: string;
  lastEventTime: string;
  updatedAt: string;
}

export interface SubmitReceipt {
  status: "SUBMITTED";
  eventId: string;
  batchId: string;
  dataHash: string;
  txId: string;
  recordedAt: string;
  submitterMspId: string;
  currentState: typeof INITIAL_BATCH_STATE;
}

export interface HealthResult {
  status: "OK";
  contract: "AgriTraceContract";
  schemaVersion: typeof SCHEMA_VERSION;
}
