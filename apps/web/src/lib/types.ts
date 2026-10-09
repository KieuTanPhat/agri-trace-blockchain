export type Role =
  | "SYSTEM_ADMIN"
  | "FARM_STAFF"
  | "IOT_DEVICE"
  | "TRANSPORTER"
  | "RETAILER"
  | "AUDITOR"
  | "SYSTEM_ACTOR";

export type ProductionCycleState =
  "CREATED" | "PLANTED" | "GROWING" | "COMPLETED" | "CANCELLED";
export type LotState =
  | "HARVESTED"
  | "IN_TRANSPORT"
  | "ARRIVED"
  | "RETAIL_RECEIVED"
  | "FOR_SALE"
  | "SOLD"
  | "RECALLED"
  | "EXPIRED"
  | "DAMAGED"
  | "REJECTED";

export type AllowedCommand =
  | "createShipment"
  | "reportDamage"
  | "startTransport"
  | "reportArrival"
  | "receiveRetail"
  | "rejectRetail";

export type ProofStatus =
  "VERIFIED" | "PENDING" | "INTEGRITY_WARNING" | "BLOCKCHAIN_UNAVAILABLE";

export type Organization = {
  organizationId: string;
  name: string;
  type: "FARM" | "TRANSPORTER" | "RETAILER" | "AUDITOR";
};

export type ProductionCycleSummary = {
  cycleId: string;
  cycleCode: string;
  currentState: ProductionCycleState;
  startDate?: string;
};

export type TraceEvent = {
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
  eventType: string;
  eventTime: string;
  summary: string;
  proofStatus: ProofStatus;
  actor: {
    userId?: string;
    role: Role;
    organizationId?: string;
    organizationName: string;
  };
};

export type LotTrace = {
  lotId: string;
  lotCode: string;
  productName: string;
  harvestTime: string;
  damagedQuantity?: number;
  quantityMovements?: {
    id: string;
    type: string;
    quantity: number;
    beforeQty: number;
    delta: number;
    afterQty: number;
    unit: string;
    createdAt: string;
  }[];
  initialQuantity: number;
  availableQuantity: number;
  unit: string;
  currentState: LotState;
  version?: number;
  traceToken?: string;
  productionCycle: ProductionCycleSummary;
  farmOrg: Organization;
  retailerOrg?: Organization;
  allowedCommands: AllowedCommand[];
  proofStatus: ProofStatus;
  timeline: TraceEvent[];
  blockchainProof?: {
    network: string;
    txId?: string;
    dataHash: string;
    transactionStatus: "PENDING" | "CONFIRMED" | "FAILED";
    recordedAt?: string | null;
  };
  shipment?: {
    shipmentId: string;
    status:
      | "CREATED"
      | "IN_TRANSIT"
      | "ARRIVED"
      | "DELIVERED"
      | "REJECTED"
      | "FAILED";
    version: number;
    transporterOrgId: string;
    retailerOrgId: string;
    origin: string;
    destination: string;
    shippedQuantity: number;
    receivedQuantity?: number | null;
    rejectedQuantity?: number | null;
  };
};

// Matches the public projection in the API's toPublicLotDto presenter.
export type PublicLotTrace = {
  lotId: string;
  traceToken: string;
  lotCode: string;
  productName: string;
  harvestTime: string;
  initialQuantity: number;
  availableQuantity: number;
  unit: string;
  currentState: LotState;
  productionCycle: {
    cycleId: string;
    cycleCode: string;
    currentState: ProductionCycleState;
    startDate: string | null;
  };
  farmOrg: Organization;
  allowedCommands: [];
  proofStatus: ProofStatus;
  timeline: {
    eventId: string;
    entityType: TraceEvent["entityType"];
    eventType: string;
    eventTime: string;
    summary: string;
    proofStatus: ProofStatus;
    actor: { role: "SYSTEM_ACTOR"; organizationName: string };
  }[];
  blockchainProof?: {
    network: string;
    txId: string | null;
    dataHash: string;
    transactionStatus: "PENDING" | "CONFIRMED" | "FAILED";
    recordedAt: string | null;
  };
  shipment: {
    status: NonNullable<LotTrace["shipment"]>["status"];
    origin: string;
    destination: string;
    pickupTime: string | null;
    arrivalTime: string | null;
    receivedTime: string | null;
  } | null;
  certificates: {
    type: string;
    issuer: string;
    issueDate: string;
    expiryDate: string | null;
    documentHash: string;
    status: "APPROVED";
  }[];
};

export type DashboardStat = { label: string; value: string };
export type Dashboard = {
  featuredLot: LotTrace | null;
  stats: DashboardStat[];
};

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  organizationId: string | null;
  role: { code: Role; name: string };
  accountStatus: string;
};

export type LoginResponse = {
  accessToken: string;
  tokenType: "Bearer";
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
};

export type ProductionCycleOption = {
  id: string;
  cycleCode: string;
  currentState: ProductionCycleState;
  version: number;
  harvestUnit?: string | null;
  product: { id: string; productName: string; defaultUnit?: string | null };
  farm: { id: string; name: string };
};

export type CommandInput = {
  transporterOrgId?: string;
  retailerOrgId?: string;
  origin?: string;
  destination?: string;
  quantity?: number;
  reason?: string;
  receivedQuantity?: number;
  damagedQuantity?: number;
  note?: string;
};

export type ApiError = {
  status: 403 | 409 | 422 | 503;
  code: string;
  message: string;
  details?: Record<string, string[]>;
};

export type SensorReadingRequest = {
  deviceId: string;
  cycleId: string;
  sensorType: string;
  value: number;
  unit: string;
  recordedAt: string;
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
