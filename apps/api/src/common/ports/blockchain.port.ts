/** Application contract; it does not import the Fabric SDK or gateway package. */
export interface BlockchainTraceEventInput {
  eventId: string;
  entityType:
    | 'PRODUCTION_CYCLE'
    | 'CARE'
    | 'SENSOR'
    | 'SENSOR_DIGEST'
    | 'HARVEST'
    | 'LOT'
    | 'SHIPMENT'
    | 'SHIPMENT_TELEMETRY'
    | 'INSPECTION'
    | 'CERTIFICATE';
  entityId: string;
  cycleId?: string;
  lotId?: string;
  eventType: string;
  eventTime: string;
  dataHash: string;
  previousEventHash?: string;
  schemaVersion: '2.0.0';
  canonicalizationVersion: 'RFC8785';
  actorContext: {
    actorUserId?: string;
    organizationId?: string;
    role: string;
    authProofType:
      | 'DIGITAL_SIGNATURE'
      | 'SIGNED_ASSERTION'
      | 'TOKEN_FINGERPRINT'
      | 'DEVICE_SIGNATURE'
      | 'SYSTEM_ASSERTION';
    actorAuthProof: string;
  };
  payloadMetadata?: Record<string, unknown>;
}

// Optional fields are intentional: the worker owns receipt validation and its
// existing retry/dead-letter decisions, including malformed gateway responses.
export interface BlockchainReceipt {
  txId?: string;
  recordedAt?: string;
  channelId?: string;
  dataHash?: string;
}

export interface BlockchainAdapter {
  submitTraceEvent(
    input: BlockchainTraceEventInput,
  ): Promise<BlockchainReceipt>;
  getProof(eventId: string): Promise<BlockchainReceipt>;
}

/** Resolve lazily so startup never opens a blockchain connection. */
export interface BlockchainAdapterFactory {
  getAdapter(): Promise<BlockchainAdapter>;
}

export const BLOCKCHAIN_ADAPTER_FACTORY = Symbol('BLOCKCHAIN_ADAPTER_FACTORY');
