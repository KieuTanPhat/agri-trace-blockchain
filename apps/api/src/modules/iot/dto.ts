import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

export class IngestSensorReadingDto {
  @ApiProperty({ type: String, maxLength: 120 })
  @IsString()
  @MaxLength(120)
  deviceId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  cycleId!: string;
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  sensorType!: string;
  @ApiProperty({ type: Number })
  @Type(() => Number)
  @IsNumber()
  value!: number;
  @ApiProperty({ type: String, maxLength: 30 })
  @IsString()
  @MaxLength(30)
  unit!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  recordedAt!: string;
}

export class CreateSensorDigestDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodEnd!: string;
  @ApiProperty({ type: Boolean, required: false, nullable: true })
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

export class IngestShipmentTelemetryDto {
  @ApiProperty({ type: String, maxLength: 120 })
  @IsString()
  @MaxLength(120)
  deviceId!: string;
  @ApiProperty({
    type: Number,
    required: false,
    nullable: true,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  deviceSequence?: number;
  @ApiProperty({ type: Number })
  @Type(() => Number)
  @IsNumber()
  latitude!: number;
  @ApiProperty({ type: Number })
  @Type(() => Number)
  @IsNumber()
  longitude!: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  accuracy?: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  speed?: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  heading?: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  temperature?: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  humidity?: number;
  @ApiProperty({ type: Number, required: false, nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  battery?: number;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  recordedAt!: string;
}

export class CreateTelemetryDigestDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodStart!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  periodEnd!: string;
  @ApiProperty({ type: Boolean, required: false, nullable: true })
  @IsOptional()
  @IsBoolean()
  isFinal?: boolean;
}

export class BindShipmentDeviceDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  deviceId!: string;
  @ApiProperty({ type: String, required: false, nullable: true })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateIotDeviceDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  organizationId!: string;
  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  cycleId?: string;
  @ApiProperty({ type: String, maxLength: 120 })
  @IsString()
  @MaxLength(120)
  deviceCode!: string;
  @ApiProperty({ type: String, maxLength: 255 })
  @IsString()
  @MaxLength(255)
  name!: string;
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  type!: string;
}
