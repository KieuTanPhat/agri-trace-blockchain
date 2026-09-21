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
  Min,
} from 'class-validator';

export class IngestSensorReadingDto {
  @IsString() @MaxLength(120) deviceId!: string;
  @IsUUID() cycleId!: string;
  @IsString() @MaxLength(100) sensorType!: string;
  @Type(() => Number) @IsNumber() value!: number;
  @IsString() @MaxLength(30) unit!: string;
  @IsDateString() recordedAt!: string;
}

export class CreateSensorDigestDto {
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsBoolean() isFinal?: boolean;
}

export class IngestShipmentTelemetryDto {
  @IsString() @MaxLength(120) deviceId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) deviceSequence?: number;
  @Type(() => Number) @IsNumber() latitude!: number;
  @Type(() => Number) @IsNumber() longitude!: number;
  @IsOptional() @Type(() => Number) @IsNumber() accuracy?: number;
  @IsOptional() @Type(() => Number) @IsNumber() speed?: number;
  @IsOptional() @Type(() => Number) @IsNumber() heading?: number;
  @IsOptional() @Type(() => Number) @IsNumber() temperature?: number;
  @IsOptional() @Type(() => Number) @IsNumber() humidity?: number;
  @IsOptional() @Type(() => Number) @IsNumber() battery?: number;
  @IsDateString() recordedAt!: string;
}

export class CreateTelemetryDigestDto {
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsBoolean() isFinal?: boolean;
}

export class BindShipmentDeviceDto {
  @IsUUID() deviceId!: string;
  @IsOptional() @IsString() note?: string;
}

export class CreateIotDeviceDto {
  @IsUUID() organizationId!: string;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsString() @MaxLength(120) deviceCode!: string;
  @IsString() @MaxLength(255) name!: string;
  @IsString() @MaxLength(100) type!: string;
}
