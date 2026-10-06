import {
    IsOptional,
    IsUUID,
    IsString,
    MaxLength,
    IsDateString,
    IsEnum,
    IsInt,
    Min,
    Max
} from "class-validator";
import { Type } from 'class-transformer';

export enum SensorHistoryInterval {
    RAW = 'RAW',
    HOUR = 'HOUR',
    DAY = 'DAY'
}


export class SensorHistoryQueryDto {
    @IsOptional()
    @IsUUID()
    deviceId?: string;

    @IsOptional()
    @IsUUID()
    cycleId?: string;

    @IsOptional()
    @IsUUID()
    harvestId?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    sensorType?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsEnum(SensorHistoryInterval)
    interval: SensorHistoryInterval = SensorHistoryInterval.RAW;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit: number = 100;
}

export class ShipmentTelemetryQueryDto {
    @IsUUID()
    shipmentId!: string;

    @IsOptional()
    @IsUUID()
    deviceId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsEnum(SensorHistoryInterval)
    interval: SensorHistoryInterval = SensorHistoryInterval.RAW;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page: number = 1;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(500)
    limit: number = 100;
}
