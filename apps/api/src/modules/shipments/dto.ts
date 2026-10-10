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
  @IsUUID() lotId!: string;
  @IsUUID() transporterOrgId!: string;
  @IsUUID() retailerOrgId!: string;
  @IsString() origin!: string;
  @IsString() destination!: string;
  @IsOptional() @IsDateString() plannedPickupTime?: string;
  @IsOptional() @IsDateString() expectedArrivalTime?: string;
  @IsOptional() @IsString() vehicleRef?: string;
}

export class ShipmentTransitionDto {
  @Type(() => Number) @IsInt() @Min(0) version!: number;
  @Type(() => Number) @IsInt() @Min(0) lotVersion!: number;
  @IsOptional() @IsDateString() occurredAt?: string;
}

export class ReceiveShipmentDto extends ShipmentTransitionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  receivedQuantity!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  damagedQuantity?: number;
  @IsOptional() @IsString() note?: string;
}

export class RejectShipmentDto extends ShipmentTransitionDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}

export class DamageShipmentDto extends ShipmentTransitionDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
  @IsOptional() @IsString() @MaxLength(2048) evidenceRef?: string;
}
