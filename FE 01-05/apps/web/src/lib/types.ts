export type Role = "SYSTEM_ADMIN" | "FARM_STAFF" | "IOT_DEVICE" | "TRANSPORTER" | "RETAILER" | "AUDITOR" | "CONSUMER";

export type BatchState =
  | "CREATED"
  | "PLANTED"
  | "HARVESTED"
  | "IN_TRANSPORT"
  | "RETAIL_RECEIVED"
  | "FOR_SALE"
  | "CANCELLED"
  | "DAMAGED"
  | "REJECTED";

export type AllowedCommand =
  | "createBatch"
  | "recordPlanting"
  | "recordCare"
  | "recordHarvest"
  | "createShipment"
  | "reportDamage"
  | "startTransport"
  | "completeTransport"
  | "receiveRetail"
  | "rejectRetail"
  | "markForSale";

export type ProofStatus = "verified" | "pending" | "mismatch" | "unavailable";

export type Organization = {
  organizationId: string;
  name: string;
  type: "FARM" | "TRANSPORTER" | "RETAILER";
};

export type TraceEvent = {
  eventId: string;
  eventType: string;
  eventTime: string;
  summary: string;
  proofStatus: ProofStatus;
  actor: {
    userId: string;
    role: Role;
    organizationId: string;
    organizationName: string;
  };
};

export type Batch = {
  batchId: string;
  batchCode: string;
  productName: string;
  currentState: BatchState;
  farmOrg: Organization;
  retailerOrg?: Organization;
  allowedCommands: AllowedCommand[];
  proofStatus: ProofStatus;
  timeline: TraceEvent[];
  blockchainProof: {
    network: string;
    txId: string;
    dataHash: string;
    recordedAt: string;
  };
};

export type DashboardStat = {
  label: string;
  value: string;
};

export type Dashboard = {
  featuredBatch: Batch;
  stats: DashboardStat[];
};

export type ApiError = {
  status: 403 | 409 | 422 | 503;
  code: string;
  message: string;
  details?: Record<string, string[]>;
};

export type SensorReadingRequest = {
  deviceId: string;
  batchId: string;
  temperature: number;
  humidity: number;
  timestampUtc: string;
};

export type SensorReadingResponse = {
  status: "accepted" | "rejected";
  readingId?: string;
  digestPreview?: {
    periodStart: string;
    periodEnd: string;
    readingCount: number;
  };
  error?: ApiError;
};
