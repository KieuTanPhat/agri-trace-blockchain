import { ApiProperty, PickType } from '@nestjs/swagger';
import {
  OrganizationRecordDto,
  FarmRecordDto,
  PlotRecordDto,
  ProductRecordDto,
  ProductionCycleRecordDto,
  CareRecordRecordDto,
  SensorReadingRecordDto,
  SensorDigestRecordDto,
  HarvestEventRecordDto,
  LotRecordDto,
  ShipmentRecordDto,
  ShipmentTrackingBindingRecordDto,
  ShipmentTelemetryRecordDto,
  ShipmentTelemetryDigestRecordDto,
  IotDeviceRecordDto,
  CertificateRecordDto,
  InspectionRecordDto,
  ComplianceAssignmentRecordDto,
  ComplianceAssignmentAuditRecordDto,
  CycleSensorReconciliationRecordDto,
  TraceEventRecordDto,
  BlockchainProofRecordDto,
  BlockchainOutboxRecordDto,
  HarvestSensorWindowRecordDto,
} from './record.dto.js';

class NamedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}
class OrgDto extends PickType(OrganizationRecordDto, [
  'id',
  'name',
  'type',
] as const) {}
class ProductOptionDto extends PickType(ProductRecordDto, [
  'id',
  'productName',
  'defaultUnit',
] as const) {}
class CycleOptionDto extends PickType(ProductionCycleRecordDto, [
  'id',
  'cycleCode',
  'currentState',
] as const) {}
class LotOptionDto extends PickType(LotRecordDto, [
  'id',
  'lotCode',
  'currentState',
] as const) {}
class ProductBriefDto extends PickType(ProductRecordDto, [
  'id',
  'productName',
] as const) {}
class CatalogFarmDto extends FarmRecordDto {
  @ApiProperty({ type: OrganizationRecordDto })
  organization!: OrganizationRecordDto;
}
class CatalogPlotDto extends PlotRecordDto {
  @ApiProperty({ type: FarmRecordDto }) farm!: FarmRecordDto;
}
export class CatalogDto {
  @ApiProperty({ type: [ProductRecordDto] }) products!: ProductRecordDto[];
  @ApiProperty({ type: [CatalogFarmDto] }) farms!: CatalogFarmDto[];
  @ApiProperty({ type: [CatalogPlotDto] }) plots!: CatalogPlotDto[];
}
export class CycleListDto extends ProductionCycleRecordDto {
  @ApiProperty({ type: ProductOptionDto }) product!: ProductOptionDto;
  @ApiProperty({ type: NamedDto }) farm!: NamedDto;
  @ApiProperty({ type: NamedDto, nullable: true }) plot!: NamedDto | null;
}
class HarvestLotDto extends LotRecordDto {
  @ApiProperty({ type: ShipmentRecordDto, nullable: true })
  shipment!: ShipmentRecordDto | null;
}
class HarvestDetailDto extends HarvestEventRecordDto {
  @ApiProperty({ type: HarvestLotDto, nullable: true })
  lot!: HarvestLotDto | null;
  @ApiProperty({ type: HarvestSensorWindowRecordDto, nullable: true })
  sensorWindow!: HarvestSensorWindowRecordDto | null;
}
export class CycleDetailDto extends ProductionCycleRecordDto {
  @ApiProperty({ type: ProductRecordDto }) product!: ProductRecordDto;
  @ApiProperty({ type: FarmRecordDto }) farm!: FarmRecordDto;
  @ApiProperty({ type: PlotRecordDto, nullable: true })
  plot!: PlotRecordDto | null;
  @ApiProperty({ type: [CareRecordRecordDto] })
  careRecords!: CareRecordRecordDto[];
  @ApiProperty({ type: [SensorReadingRecordDto] })
  sensorReadings!: SensorReadingRecordDto[];
  @ApiProperty({ type: [SensorDigestRecordDto] })
  sensorDigests!: SensorDigestRecordDto[];
  @ApiProperty({ type: [CertificateRecordDto] })
  certificates!: CertificateRecordDto[];
  @ApiProperty({ type: [HarvestDetailDto] }) harvestEvents!: HarvestDetailDto[];
}
export class CareResultDto {
  @ApiProperty({ type: CareRecordRecordDto }) care!: CareRecordRecordDto;
  @ApiProperty() version!: number;
}
export class SensorReadingResultDto extends SensorReadingRecordDto {
  @ApiProperty() late!: boolean;
}
export class ReconciliationResultDto {
  @ApiProperty({ type: CycleSensorReconciliationRecordDto })
  reconciliation!: CycleSensorReconciliationRecordDto;
  @ApiProperty() cycleVersion!: number;
}
export class DeviceListDto extends IotDeviceRecordDto {
  @ApiProperty({ type: OrgDto }) organization!: OrgDto;
  @ApiProperty({ type: CycleOptionDto, nullable: true })
  cycle!: CycleOptionDto | null;
}
export class ReadingAcceptedDto {
  @ApiProperty({ enum: ['accepted'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) readingId!: string;
  @ApiProperty() late!: boolean;
}
export class TelemetryAcceptedDto {
  @ApiProperty({ enum: ['accepted'] }) status!: string;
  @ApiProperty({ format: 'uuid' }) telemetryId!: string;
}
export class UnboundDto {
  @ApiProperty({ enum: [true] }) unbound!: boolean;
}
class ListShipmentLotDto extends LotRecordDto {
  @ApiProperty({ type: ProductBriefDto }) product!: ProductBriefDto;
  @ApiProperty({ type: OrgDto }) organization!: OrgDto;
}
class ShipmentCountDto {
  @ApiProperty() telemetry!: number;
}
export class ShipmentListDto extends ShipmentRecordDto {
  @ApiProperty({ type: OrgDto }) transporter!: OrgDto;
  @ApiProperty({ type: OrgDto }) retailer!: OrgDto;
  @ApiProperty({ type: ListShipmentLotDto }) lot!: ListShipmentLotDto;
  @ApiProperty({ type: ShipmentTelemetryDigestRecordDto, nullable: true })
  telemetryDigest!: ShipmentTelemetryDigestRecordDto | null;
  @ApiProperty({ type: ShipmentCountDto }) _count!: ShipmentCountDto;
}
class DetailShipmentLotDto extends LotRecordDto {
  @ApiProperty({ type: ProductRecordDto }) product!: ProductRecordDto;
  @ApiProperty({ type: OrganizationRecordDto })
  organization!: OrganizationRecordDto;
}
class TrackingBindingDto extends ShipmentTrackingBindingRecordDto {
  @ApiProperty({ type: IotDeviceRecordDto }) device!: IotDeviceRecordDto;
}
export class ShipmentDetailDto extends ShipmentRecordDto {
  @ApiProperty({ type: OrganizationRecordDto })
  transporter!: OrganizationRecordDto;
  @ApiProperty({ type: OrganizationRecordDto })
  retailer!: OrganizationRecordDto;
  @ApiProperty({ type: DetailShipmentLotDto }) lot!: DetailShipmentLotDto;
  @ApiProperty({ type: [ShipmentTelemetryRecordDto] })
  telemetry!: ShipmentTelemetryRecordDto[];
  @ApiProperty({ type: ShipmentTelemetryDigestRecordDto, nullable: true })
  telemetryDigest!: ShipmentTelemetryDigestRecordDto | null;
  @ApiProperty({ type: [TrackingBindingDto] })
  trackingBindings!: TrackingBindingDto[];
}
export class ShipmentDamageDto {
  @ApiProperty({ enum: ['IN_TRANSIT', 'ARRIVED', 'FAILED'] })
  shipmentStatus!: string;
  @ApiProperty({ enum: ['IN_TRANSPORT', 'ARRIVED', 'DAMAGED'] })
  lotState!: string;
  @ApiProperty() availableQuantity!: number;
}
export class InspectionListDto extends InspectionRecordDto {
  @ApiProperty({ type: OrgDto, nullable: true }) organization!: OrgDto | null;
  @ApiProperty({ type: LotOptionDto }) lot!: LotOptionDto;
}
export class AssignmentListDto extends ComplianceAssignmentRecordDto {
  @ApiProperty({ type: NamedDto }) farm!: NamedDto;
  @ApiProperty({ type: [ComplianceAssignmentAuditRecordDto] })
  audits!: ComplianceAssignmentAuditRecordDto[];
}
class UserRoleDto {
  @ApiProperty() code!: string;
  @ApiProperty() name!: string;
}
export class UserCreatedDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'email' }) email!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'LOCKED'] })
  accountStatus!: string;
}
export class UserListDto extends UserCreatedDto {
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: UserRoleDto }) role!: UserRoleDto;
  @ApiProperty({ type: OrgDto, nullable: true }) organization!: OrgDto | null;
}
export class UserStatusDto extends PickType(UserCreatedDto, [
  'id',
  'email',
  'accountStatus',
] as const) {
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
}
export class TraceHistoryDto extends TraceEventRecordDto {
  @ApiProperty({ type: BlockchainProofRecordDto, nullable: true })
  blockchainProof!: BlockchainProofRecordDto | null;
  @ApiProperty({ type: BlockchainOutboxRecordDto, nullable: true })
  blockchainOutbox!: BlockchainOutboxRecordDto | null;
}
export class TraceProofDto {
  @ApiProperty({ format: 'uuid' }) eventId!: string;
  @ApiProperty() network!: string;
  @ApiProperty() channelId!: string;
  @ApiProperty({ type: String, nullable: true }) txId!: string | null;
  @ApiProperty() dataHash!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  recordedAt!: string | null;
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'FAILED'] })
  transactionStatus!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  nextAttemptAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastError!: string | null;
  @ApiProperty() localHashMatches!: boolean;
  @ApiProperty({
    enum: [
      'VERIFIED',
      'PENDING',
      'INTEGRITY_WARNING',
      'BLOCKCHAIN_UNAVAILABLE',
    ],
  })
  proofStatus!: string;
}

export class VerifyProofDto extends PickType(TraceProofDto, [
  'eventId',
  'channelId',
  'txId',
  'dataHash',
  'recordedAt',
  'attemptCount',
  'lastError',
  'localHashMatches',
  'proofStatus',
] as const) {
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'FAILED'] }) status!: string;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'DEAD_LETTER'] })
  deliveryStatus!: string;
}
