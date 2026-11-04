import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const DEVICE_KINDS = ['FIELD_SENSOR', 'GPS_TRACKER'] as const;
export const FIELD_SENSOR_TYPES = ['TEMPERATURE', 'HUMIDITY', 'SOIL_MOISTURE'] as const;
const SPKI = /^[A-Za-z0-9_-]{59}$/;
const CODE = /^[A-Za-z0-9._:-]{3,120}$/;

export class RegisterDeviceInput {
  @ApiProperty({ enum: DEVICE_KINDS }) @IsIn(DEVICE_KINDS) kind!: (typeof DEVICE_KINDS)[number];
  @ApiProperty({ description: 'Mã in trên thiết bị (IMEI/serial)', pattern: CODE.source })
  @Matches(CODE)
  deviceCode!: string;
  @ApiProperty({ maxLength: 255 }) @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @ApiProperty({ description: 'Khóa công khai Ed25519 SPKI base64url do thiết bị tạo', pattern: SPKI.source })
  @Matches(SPKI)
  publicKey!: string;
  @ApiProperty({ description: 'Thiết bị ảo; dữ liệu luôn hiện nhãn mô phỏng' }) @IsBoolean() simulated!: boolean;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() plotId?: string;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() vehicleId?: string;
}

export class DeviceVersionInput {
  @ApiProperty({ description: 'authorityRevision hiện tại' }) @IsInt() @Min(0) version!: number;
}

export class BindDeviceInput extends DeviceVersionInput {
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) @IsOptional() @IsUUID() plotId?: string | null;
  @ApiPropertyOptional({ format: 'uuid', nullable: true }) @IsOptional() @IsUUID() vehicleId?: string | null;
}

export class RotateDeviceKeyInput extends DeviceVersionInput {
  @ApiProperty({ pattern: SPKI.source }) @Matches(SPKI) publicKey!: string;
}

export class DeviceStatusInput extends DeviceVersionInput {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE'] }) @IsIn(['ACTIVE', 'INACTIVE']) status!: 'ACTIVE' | 'INACTIVE';
}

export class SignedReadingItem {
  @ApiProperty() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) sequence!: number;
  @ApiProperty({ enum: FIELD_SENSOR_TYPES }) @IsIn(FIELD_SENSOR_TYPES) sensorType!: string;
  @ApiProperty() @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-100) @Max(1000) value!: number;
  @ApiProperty({ maxLength: 30 }) @IsString() @MaxLength(30) unit!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() recordedAt!: string;
}

export class SignedReadingsInput {
  @ApiProperty() @Matches(CODE) deviceCode!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() sentAt!: string;
  @ApiProperty({ type: [SignedReadingItem] })
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SignedReadingItem)
  readings!: SignedReadingItem[];
}

export class SignedPositionItem {
  @ApiProperty() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) sequence!: number;
  @ApiProperty({ format: 'date-time' }) @IsDateString() recordedAt!: string;
  @ApiProperty() @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @ApiProperty() @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100000) accuracyM?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(400) speedKmh?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(359.99) heading?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(64) satellites?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) battery?: number;
}

export class SignedPositionsInput {
  @ApiProperty() @Matches(CODE) deviceCode!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() sentAt!: string;
  @ApiProperty({ type: [SignedPositionItem] })
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SignedPositionItem)
  positions!: SignedPositionItem[];
}

export class DeviceIngestResultDto {
  @ApiProperty() accepted!: number;
  @ApiProperty({ description: 'Số thứ tự đã nhận trước đó (gửi lại)' }) duplicates!: number;
  @ApiProperty({ description: 'Ngoài phạm vi: không có vụ/phiếu đang chạy' }) ignored!: number;
  @ApiProperty({ description: 'Đến sau khi đã chốt (đánh dấu muộn)' }) late!: number;
  @ApiProperty() anomalies!: number;
  @ApiProperty({ description: 'Bị từ chối vì thời gian không hợp lệ' }) rejected!: number;
}

/** A device asks what it is attached to and which trip its vehicle is on. */
export class DeviceAssignmentInput {
  @ApiProperty() @Matches(CODE) deviceCode!: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() sentAt!: string;
}

class AssignedDeviceDto {
  @ApiProperty() deviceCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty() type!: string;
  @ApiProperty() status!: string;
  @ApiProperty() simulated!: boolean;
  @ApiProperty() active!: boolean;
}
class AssignedPlotDto {
  @ApiProperty() name!: string;
  @ApiProperty() farmName!: string;
  @ApiProperty({ type: [String] }) runningCycles!: string[];
}
class AssignedVehicleDto {
  @ApiProperty() registration!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() status!: string;
}
class AssignedPlaceDto {
  @ApiProperty() name!: string;
  @ApiProperty({ type: Number, nullable: true }) latitude!: number | null;
  @ApiProperty({ type: Number, nullable: true }) longitude!: number | null;
  @ApiProperty({ enum: ['SITE', 'PROVINCE'], nullable: true }) source!: string | null;
}
class PlannedTripDto {
  @ApiProperty() distanceM!: number;
  @ApiProperty() durationS!: number;
  @ApiProperty() estimated!: boolean;
}
class AssignedTripDto {
  @ApiProperty({ format: 'uuid' }) transferId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) inTransitAt!: string;
  @ApiProperty({ type: AssignedPlaceDto }) origin!: AssignedPlaceDto;
  @ApiProperty({ type: AssignedPlaceDto }) destination!: AssignedPlaceDto;
  @ApiProperty({ type: PlannedTripDto, nullable: true }) planned!: PlannedTripDto | null;
}
export class DeviceAssignmentDto {
  @ApiProperty({ type: AssignedDeviceDto }) device!: AssignedDeviceDto;
  @ApiProperty({ type: AssignedPlotDto, nullable: true }) plot!: AssignedPlotDto | null;
  @ApiProperty({ type: AssignedVehicleDto, nullable: true }) vehicle!: AssignedVehicleDto | null;
  @ApiProperty({ type: AssignedTripDto, nullable: true }) trip!: AssignedTripDto | null;
}

export class CycleReadingsQuery {
  @ApiPropertyOptional({ description: 'Số giờ gần nhất (mặc định cả vụ)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 365)
  hours?: number;
}
