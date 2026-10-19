import { ApiProperty } from '@nestjs/swagger';
import { ROLE_CODES } from '../auth/role-codes.js';
import { LOT_COMMANDS } from './lot-action.policy.js';
import {
  LotState,
  ProductionCycleState,
  ShipmentState,
  OrganizationType,
} from '../../generated/prisma/enums.js';
import {
  HarvestEventRecordDto,
  LotRecordDto,
  TraceQrRecordDto,
  HarvestSensorWindowRecordDto,
} from '../../common/api/record.dto.js';

export const PROOF_STATUSES = [
  'VERIFIED',
  'PENDING',
  'INTEGRITY_WARNING',
  'BLOCKCHAIN_UNAVAILABLE',
] as const;
const ENTITY_TYPES = [
  'PRODUCTION_CYCLE',
  'CARE',
  'SENSOR',
  'SENSOR_DIGEST',
  'HARVEST',
  'LOT',
  'SHIPMENT',
  'SHIPMENT_TELEMETRY',
  'INSPECTION',
  'CERTIFICATE',
] as const;

export class OrganizationSummaryDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: OrganizationType }) type!: string;
}
export class CycleSummaryDto {
  @ApiProperty({ format: 'uuid' }) cycleId!: string;
  @ApiProperty() cycleCode!: string;
  @ApiProperty({ enum: ProductionCycleState }) currentState!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  startDate!: string | null;
}
export class SensorEvidenceDto {
  @ApiProperty({
    enum: ['FINALIZED', 'NO_DATA', 'LEGACY_UNVERIFIED', 'INTEGRITY_WARNING'],
  })
  status!: string;
  @ApiProperty() readingCount!: number;
  @ApiProperty({ type: String, nullable: true }) digestHash!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  periodStart!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  periodEnd!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  finalizedAt!: string | null;
  @ApiProperty() lateReadingCount!: number;
}
export class LotProofDto {
  @ApiProperty() network!: string;
  @ApiProperty({ type: String, nullable: true }) txId!: string | null;
  @ApiProperty() dataHash!: string;
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'FAILED'] })
  transactionStatus!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  recordedAt!: string | null;
}
class InternalTimelineActorDto {
  @ApiProperty({ required: false, format: 'uuid' }) userId?: string;
  @ApiProperty({ enum: ROLE_CODES }) role!: string;
  @ApiProperty({ required: false, format: 'uuid' }) organizationId?: string;
  @ApiProperty() organizationName!: string;
}
class PublicTimelineActorDto {
  @ApiProperty({ enum: ['SYSTEM_ACTOR'] }) role!: string;
  @ApiProperty() organizationName!: string;
}
class TimelineBaseDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty({ enum: ENTITY_TYPES }) entityType!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty({ format: 'date-time' }) eventTime!: string;
  @ApiProperty() summary!: string;
  @ApiProperty({ enum: PROOF_STATUSES }) proofStatus!: string;
}
export class InternalTimelineDto extends TimelineBaseDto {
  @ApiProperty({ type: InternalTimelineActorDto })
  actor!: InternalTimelineActorDto;
}
export class PublicTimelineDto extends TimelineBaseDto {
  @ApiProperty({ type: PublicTimelineActorDto }) actor!: PublicTimelineActorDto;
}
class MovementDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() type!: string;
  @ApiProperty() quantity!: number;
  @ApiProperty() beforeQty!: number;
  @ApiProperty() delta!: number;
  @ApiProperty() afterQty!: number;
  @ApiProperty() unit!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class InternalShipmentDto {
  @ApiProperty({ format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ enum: ShipmentState }) status!: string;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'uuid' }) transporterOrgId!: string;
  @ApiProperty({ format: 'uuid' }) retailerOrgId!: string;
  @ApiProperty() origin!: string;
  @ApiProperty() destination!: string;
  @ApiProperty() shippedQuantity!: number;
  @ApiProperty({ type: Number, nullable: true }) receivedQuantity!:
    number | null;
  @ApiProperty({ type: Number, nullable: true }) rejectedQuantity!:
    number | null;
  @ApiProperty({
    enum: ['STANDARD', 'DUAL_SIGNED'],
    description:
      'DUAL_SIGNED: lấy hàng và giao hàng cần bàn giao hai bên có chữ ký',
  })
  handoverMode!: string;
}
class PublicShipmentDto {
  @ApiProperty({ enum: ShipmentState }) status!: string;
  @ApiProperty() origin!: string;
  @ApiProperty() destination!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  pickupTime!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  arrivalTime!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  receivedTime!: string | null;
}
class PublicCertificateDto {
  @ApiProperty() type!: string;
  @ApiProperty() issuer!: string;
  @ApiProperty({ format: 'date-time' }) issueDate!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expiryDate!: string | null;
  @ApiProperty() documentHash!: string;
  @ApiProperty({ enum: ['APPROVED'] }) status!: string;
}
class CustodianDto {
  @ApiProperty({ enum: ['FARM_STAFF', 'TRANSPORTER', 'RETAILER'] })
  role!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
}
class LotBaseDto {
  @ApiProperty({ format: 'uuid' }) lotId!: string;
  @ApiProperty() lotCode!: string;
  @ApiProperty({ type: String, nullable: true, required: false }) lotName?: string | null;
  @ApiProperty() productName!: string;
  @ApiProperty({ format: 'date-time' }) harvestTime!: string;
  @ApiProperty() initialQuantity!: number;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty() unit!: string;
  @ApiProperty({ enum: LotState }) currentState!: string;
  @ApiProperty({ type: CycleSummaryDto }) productionCycle!: CycleSummaryDto;
  @ApiProperty({ type: OrganizationSummaryDto })
  farmOrg!: OrganizationSummaryDto;
  @ApiProperty({ enum: PROOF_STATUSES }) proofStatus!: string;
  @ApiProperty({ type: LotProofDto, required: false })
  blockchainProof?: LotProofDto;
  @ApiProperty({ type: String, nullable: true, format: 'date' }) expiryDate!:
    string | null;
  @ApiProperty() isExpired!: boolean;
  @ApiProperty() quantityReconciled!: boolean;
  @ApiProperty() stateReconciled!: boolean;
  @ApiProperty({ type: [String] }) warnings!: string[];
  @ApiProperty({ type: SensorEvidenceDto }) sensorEvidence!: SensorEvidenceDto;
}
export class InternalLotDto extends LotBaseDto {
  @ApiProperty({ type: Number, nullable: true, required: false }) packageCount?: number | null;
  @ApiProperty({ type: String, nullable: true, required: false }) packaging?: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date', required: false }) packedAt?: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid', required: false }) initialStorageSiteId?: string | null;
  @ApiProperty({ type: Boolean, required: false }) distributionMode?: boolean;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  chainId!: string | null;
  @ApiProperty({ required: false }) traceToken?: string;
  @ApiProperty() version!: number;
  @ApiProperty() damagedQuantity!: number;
  @ApiProperty({ type: [MovementDto] }) quantityMovements!: MovementDto[];
  @ApiProperty({ type: OrganizationSummaryDto, required: false })
  retailerOrg?: OrganizationSummaryDto;
  @ApiProperty({ enum: LOT_COMMANDS, isArray: true })
  allowedCommands!: string[];
  @ApiProperty({ type: [InternalTimelineDto] })
  timeline!: InternalTimelineDto[];
  @ApiProperty({ type: InternalShipmentDto, required: false })
  shipment?: InternalShipmentDto;
  @ApiProperty({ type: CustodianDto, nullable: true })
  custodian!: CustodianDto | null;
}
export class PublicDistributionLegDto {
  @ApiProperty({type:String,nullable:true,description:'Accepted quantity after completed handover only'}) receivedQuantity!:string|null;
  @ApiProperty({type:String,nullable:true,description:'Current unresolved carrier custody for this lot only'}) pendingQuantity!:string|null;
  @ApiProperty({type:String,nullable:true}) returnedQuantity!:string|null;
  @ApiProperty({enum:['PLANNED','CARRIER','RECEIVER','RECEIVER_WITH_REMAINDER']}) custodyStage!:string;
  @ApiProperty() senderName!: string;
  @ApiProperty() carrierName!: string;
  @ApiProperty() receiverName!: string;
  @ApiProperty({ description: 'Quantity for this source lot only' })
  quantity!: string;
  @ApiProperty() unit!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ format: 'date-time' }) recordedAt!: string;
}
export class PublicTraceNoticeDto {
  @ApiProperty({ enum: ['WARNING', 'RECALL'] }) kind!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class PublicLotDto extends LotBaseDto {
  @ApiProperty({type:String,isArray:true,required:false,description:'Advisory based on declared production journal, not a certification'}) productionWarnings?:string[];
  @ApiProperty({ type: [PublicTraceNoticeDto], required: false })
  notices?: PublicTraceNoticeDto[];
  @ApiProperty({ type: [PublicDistributionLegDto], required: false })
  distributionJourney?: PublicDistributionLegDto[];
  @ApiProperty() traceToken!: string;
  @ApiProperty({ type: [String], maxItems: 0 }) allowedCommands!: [];
  @ApiProperty({ type: [PublicTimelineDto] }) timeline!: PublicTimelineDto[];
  @ApiProperty({ type: PublicShipmentDto, nullable: true })
  shipment!: PublicShipmentDto | null;
  @ApiProperty({ type: [PublicCertificateDto] })
  certificates!: PublicCertificateDto[];
}
class DashboardStatDto {
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
}
export class DashboardDto {
  @ApiProperty({ type: InternalLotDto, nullable: true })
  featuredLot!: InternalLotDto | null;
  @ApiProperty({ type: [DashboardStatDto] }) stats!: DashboardStatDto[];
}
export class LotCommandResultDto {
  @ApiProperty({ format: 'uuid' }) lotId!: string;
  @ApiProperty({ enum: LotState }) currentState!: string;
  @ApiProperty() version!: number;
  @ApiProperty() availableQuantity!: number;
  @ApiProperty({ format: 'uuid' }) eventId!: string;
}
export class HarvestResultDto {
  @ApiProperty({ type: HarvestEventRecordDto }) harvest!: HarvestEventRecordDto;
  @ApiProperty({ type: LotRecordDto }) lot!: LotRecordDto;
  @ApiProperty({ type: TraceQrRecordDto }) traceQr!: TraceQrRecordDto;
  @ApiProperty({ type: HarvestSensorWindowRecordDto })
  sensorWindow!: HarvestSensorWindowRecordDto;
  @ApiProperty() cycleVersion!: number;
}
