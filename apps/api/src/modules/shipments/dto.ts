import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
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
  @Type(() => Number) @IsNumber() @IsPositive() receivedQuantity!: number;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  damagedQuantity?: number;
  @IsOptional() @IsString() note?: string;
}

export class RejectShipmentDto extends ShipmentTransitionDto {
  @IsString() reason!: string;
}

export class DamageShipmentDto extends ShipmentTransitionDto {
  @Type(() => Number) @IsNumber() @IsPositive() quantity!: number;
  @IsString() reason!: string;
}
