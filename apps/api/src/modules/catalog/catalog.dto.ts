import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  IsNumber,
  IsPositive,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
export class ProductDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  productName!: string;
  @IsOptional() @IsString() @MaxLength(255) variety?: string;
  @IsOptional() @IsString() @MaxLength(30) defaultUnit?: string;
}
export class FarmDto {
  @IsUUID() organizationId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @IsOptional() @IsString() location?: string;
}
export class PlotDto {
  @IsUUID() farmId!: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
  @IsOptional() @Type(() => Number) @IsNumber() @IsPositive() area?: number;
  @IsOptional() @IsString() @MaxLength(30) unit?: string;
  @IsOptional() @IsString() location?: string;
}
