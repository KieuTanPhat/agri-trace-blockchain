import { ApiProperty } from '@nestjs/swagger';
import * as Enums from '../../generated/prisma/enums.js';

// JSON representations returned by authenticated API routes.
// Decimal and bigint values serialize as strings. Public trace uses separate projections.

export class RoleRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
}

export class OrganizationRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: Enums.OrganizationType }) type!: Enums.OrganizationType;
  @ApiProperty({ enum: Enums.OrganizationStatus })
  status!: Enums.OrganizationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class FarmRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
  @ApiProperty({ enum: Enums.OrganizationStatus })
  status!: Enums.OrganizationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class PlotRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) farmId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  area!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ type: String, nullable: true }) location!: string | null;
  @ApiProperty({ enum: Enums.OrganizationStatus })
  status!: Enums.OrganizationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ProductRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) productName!: string;
  @ApiProperty({ type: String, nullable: true }) variety!: string | null;
  @ApiProperty({ type: String, nullable: true }) defaultUnit!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ enum: Enums.OrganizationStatus })
  status!: Enums.OrganizationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ProductionCycleRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) cycleCode!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) farmId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) farmOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) plotId!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startDate!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  plannedHarvest!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  maxHarvestQuantity!: string | null;
  @ApiProperty({ type: String, nullable: true }) harvestUnit!: string | null;
  @ApiProperty({ enum: Enums.ProductionCycleState })
  currentState!: Enums.ProductionCycleState;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class CareRecordRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String }) careType!: string;
  @ApiProperty({ type: String, format: 'date-time' }) eventTime!: string;
  @ApiProperty({ type: String, nullable: true }) materialName!: string | null;
  @ApiProperty({ type: String, nullable: true }) activeIngredient!:
    string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  quantity!: string | null;
  @ApiProperty({ type: String, nullable: true }) unit!: string | null;
  @ApiProperty({ type: String, nullable: true }) method!: string | null;
  @ApiProperty({ type: String, nullable: true }) applicationArea!:
    string | null;
  @ApiProperty({ type: Number, nullable: true }) withdrawalPeriod!:
    number | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) evidenceRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class IotDeviceRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) cycleId!:
    string | null;
  @ApiProperty({ type: String }) deviceCode!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) type!: string;
  @ApiProperty({ enum: Enums.DeviceStatus }) status!: Enums.DeviceStatus;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSeenAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class SensorReadingRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) deviceId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String }) sensorType!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  value!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) ingestTime!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class SensorDigestRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' }) periodEnd!: string;
  @ApiProperty({ type: Number }) readingCount!: number;
  @ApiProperty({ type: String }) digestHash!: string;
  @ApiProperty({ type: String }) schemaVersion!: string;
  @ApiProperty({ type: String }) canonicalizationVersion!: string;
  @ApiProperty({ type: Boolean }) isFinal!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class HarvestEventRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  finalSensorDigestId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) harvestTime!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  quantity!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String, nullable: true }) qualityNote!: string | null;
  @ApiProperty({ type: String, nullable: true }) grade!: string | null;
  @ApiProperty({ type: String, nullable: true }) harvestArea!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class LotRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) lotCode!: string;
  @ApiProperty({ type: String, format: 'uuid' }) harvestId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) productId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) farmOrgId!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  initialQuantity!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  availableQuantity!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String, nullable: true }) grade!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: string | null;
  @ApiProperty({ enum: Enums.LotState }) currentState!: Enums.LotState;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) parentLotId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) lineageType!: string | null;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ShipmentRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) lotId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) transporterOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) retailerOrgId!: string;
  @ApiProperty({ type: String }) origin!: string;
  @ApiProperty({ type: String }) destination!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  shippedQuantity!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  plannedPickupTime!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expectedArrival!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  pickupTime!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  arrivalTime!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  receivedTime!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  receivedQuantity!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  rejectedQuantity!: string | null;
  @ApiProperty({ type: String, nullable: true }) rejectReason!: string | null;
  @ApiProperty({ type: String, nullable: true }) vehicleRef!: string | null;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  conditions!: unknown | null;
  @ApiProperty({ enum: Enums.ShipmentState }) status!: Enums.ShipmentState;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ShipmentTrackingBindingRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) deviceId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) transporterOrgId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) boundAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  unboundAt!: string | null;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) boundBy!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class ShipmentTelemetryRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) deviceId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) bindingId!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Integer serialized as a string to preserve precision',
  })
  deviceSequence!: string | null;
  @ApiProperty({ type: String, nullable: true }) idempotencyKey!: string | null;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  latitude!: string;
  @ApiProperty({
    type: String,
    description: 'Exact decimal serialized as a string',
  })
  longitude!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  accuracy!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  speed!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  heading!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  temperature!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  humidity!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  battery!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) ingestTime!: string;
  @ApiProperty({ type: String, nullable: true }) validityStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) anomalyNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ShipmentTelemetryDigestRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) deviceId!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time' }) periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' }) periodEnd!: string;
  @ApiProperty({ type: Number }) readingCount!: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  firstLatitude!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  firstLongitude!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  lastLatitude!: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Exact decimal serialized as a string',
  })
  lastLongitude!: string | null;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  conditionSummary!: unknown | null;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  anomalySummary!: unknown | null;
  @ApiProperty({ type: String }) digestHash!: string;
  @ApiProperty({ type: String, nullable: true }) previousDigestHash!:
    string | null;
  @ApiProperty({ type: String }) schemaVersion!: string;
  @ApiProperty({ type: String }) canonicalizationVersion!: string;
  @ApiProperty({ type: Boolean }) isFinal!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class TraceEventRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) entityType!: string;
  @ApiProperty({ type: String, format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) cycleId!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) lotId!:
    string | null;
  @ApiProperty({ type: String }) eventType!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) actorUserId!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  actorOrganizationId!: string | null;
  @ApiProperty({ type: String }) actorRole!: string;
  @ApiProperty({ type: String, nullable: true }) authProofType!: string | null;
  @ApiProperty({ type: String, nullable: true }) actorAuthProof!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) eventTime!: string;
  @ApiProperty({ type: String, format: 'date-time' }) serverRecordedAt!: string;
  @ApiProperty({
    nullable: true,
    oneOf: [
      { type: 'object', additionalProperties: true },
      { type: 'array', items: {} },
      { type: 'string' },
      { type: 'number' },
      { type: 'boolean' },
    ],
  })
  businessData!: unknown;
  @ApiProperty({ type: String }) schemaVersion!: string;
  @ApiProperty({ type: String }) canonicalizationVersion!: string;
  @ApiProperty({ type: String }) dataHash!: string;
  @ApiProperty({ type: String, nullable: true }) previousEventHash!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  supersedesEventId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  causationEventId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class BlockchainProofRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) eventId!: string;
  @ApiProperty({ type: String }) network!: string;
  @ApiProperty({ type: String }) channelId!: string;
  @ApiProperty({ type: String, nullable: true }) txId!: string | null;
  @ApiProperty({ type: String }) dataHash!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  recordedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) relayerAddress!: string | null;
  @ApiProperty({ enum: Enums.BlockchainTransactionStatus })
  transactionStatus!: Enums.BlockchainTransactionStatus;
  @ApiProperty({ type: Number }) attemptCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextAttemptAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class BlockchainOutboxRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) eventId!: string;
  @ApiProperty({ enum: Enums.BlockchainOutboxStatus })
  status!: Enums.BlockchainOutboxStatus;
  @ApiProperty({ type: Number }) attemptCount!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextAttemptAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) leaseToken!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  leaseExpiresAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  completedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}

export class CertificateRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) lotId!:
    string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) cycleId!:
    string | null;
  @ApiProperty({ type: String }) type!: string;
  @ApiProperty({ type: String }) issuer!: string;
  @ApiProperty({ type: String, format: 'date-time' }) issueDate!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: string | null;
  @ApiProperty({ type: String }) documentRef!: string;
  @ApiProperty({ type: String }) documentHash!: string;
  @ApiProperty({ type: Boolean }) isPublic!: boolean;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) reviewedBy!:
    string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  submittedByUserId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supersedesId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) correctionReason!:
    string | null;
}

export class InspectionRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) lotId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  inspectorOrgId!: string | null;
  @ApiProperty({ enum: Enums.InspectionResult })
  result!: Enums.InspectionResult;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) inspectedAt!: string;
  @ApiProperty({ type: String, nullable: true }) evidenceRef!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  recordedByUserId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) supersedesId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) correctionReason!:
    string | null;
}

export class TraceQrRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) lotId!: string;
  @ApiProperty({ type: String }) traceToken!: string;
  @ApiProperty({ type: String }) traceUrl!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

export class ComplianceAssignmentRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) reviewerUserId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) farmId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) grantedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  revokedAt!: string | null;
}

export class ComplianceAssignmentAuditRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) assignmentId!: string;
  @ApiProperty({ type: String }) action!: string;
  @ApiProperty({ type: String, format: 'uuid' }) actorUserId!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
}

export class HarvestSensorWindowRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) harvestId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' }) periodEnd!: string;
  @ApiProperty({ type: Boolean }) includeStart!: boolean;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) readingCount!: number;
  @ApiProperty({ type: String, nullable: true }) digestHash!: string | null;
  @ApiProperty({ type: String }) schemaVersion!: string;
  @ApiProperty({ type: String, format: 'date-time' }) finalizedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  sealedAt!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reconciliationId!: string | null;
}

export class LateSensorReadingRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) readingId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) closedHarvestId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) detectedAt!: string;
}

export class CycleSensorReconciliationRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  throughHarvestId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) plantedAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cutoffEnd!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) recordedById!: string;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'date-time' }) recordedAt!: string;
}
