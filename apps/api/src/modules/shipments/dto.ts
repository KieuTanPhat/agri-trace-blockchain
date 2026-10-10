import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateShipmentDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  lotId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  transporterOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  retailerOrgId!: string;
  @ApiProperty({ type: String })
  @IsString()
  origin!: string;
  @ApiProperty({ type: String })
  @IsString()
  destination!: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  plannedPickupTime?: string;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expectedArrivalTime?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  vehicleRef?: string;
}

export class ShipmentTransitionDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lotVersion!: number;
  @ApiProperty({ type: String, required: false, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class ReceiveShipmentDto extends ShipmentTransitionDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  receivedQuantity!: number;
  @ApiProperty({ type: Number, required: false, minimum: 0, multipleOf: 0.001 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  damagedQuantity?: number;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class RejectShipmentDto extends ShipmentTransitionDto {
  @ApiProperty({ type: String, maxLength: 1000, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class DamageShipmentDto extends ShipmentTransitionDto {
  @ApiProperty({
    type: Number,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
  @ApiProperty({ type: String, maxLength: 1000, minLength: 1 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
  @ApiProperty({ type: String, required: false, maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  evidenceRef?: string;
}
