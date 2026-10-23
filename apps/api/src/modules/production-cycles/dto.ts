import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  Max,
} from 'class-validator';

export class CreateProductionCycleDto {
  @ApiProperty({ required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) name?: string;
  @ApiProperty({ required: false, minimum: 0, exclusiveMinimum: true }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() cultivatedArea?: number;
  @ApiProperty({
    type: String,
    format: 'uuid',
    description: 'Chuỗi cung ứng chứa vụ sản xuất',
  })
  @IsUUID()
  chainId!: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  farmId!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  plotId?: string;
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  productId!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' }) @IsOptional() @IsUUID() seedMaterialId?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' }) @IsOptional() @IsUUID() responsibleUserId?: string;
  @ApiProperty({ type: String, required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) cultivationMethod?: string;
  @ApiProperty({ type: String, minLength: 1, maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  cycleCode!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsDateString()
  plannedHarvest?: string;
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @Type(() => Number)
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  maxHarvestQuantity?: number;
  @ApiProperty({ type: String, minLength: 1, maxLength: 30 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  harvestUnit!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class CreateProductionCycleDraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() farmId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() plotId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() productId!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' }) @IsOptional() @IsUUID() seedMaterialId?: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' }) @IsOptional() @IsUUID() responsibleUserId?: string;
  @ApiProperty({ type: String, required: false, maxLength: 255 }) @IsOptional() @IsString() @MaxLength(255) cultivationMethod?: string;
  @ApiProperty({ minLength: 2, maxLength: 255 }) @IsString() @MinLength(2) @MaxLength(255) name!: string;
  @ApiProperty({ required: false, maxLength: 100, description: 'Mã nội bộ; hệ thống tự sinh nếu bỏ trống' }) @IsOptional() @IsString() @MaxLength(100) cycleCode?: string;
  @ApiProperty({ format: 'date' }) @IsDateString() startDate!: string;
  @ApiProperty({ format: 'date' }) @IsDateString() plannedHarvest!: string;
  @ApiProperty({ type: Number, minimum: 0, exclusiveMinimum: true }) @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @IsPositive() cultivatedArea!: number;
  @ApiProperty({ type: Number, required: false, minimum: 0, exclusiveMinimum: true }) @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @IsPositive() maxHarvestQuantity?: number;
  @ApiProperty({ maxLength: 30 }) @IsString() @MinLength(1) @MaxLength(30) harvestUnit!: string;
  @ApiProperty({ required: false }) @IsOptional() @IsString() note?: string;
}

export class LinkProductionCycleDraftDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() chainId!: string;
  @ApiProperty({ minimum: 0 }) @Type(() => Number) @IsInt() @Min(0) version!: number;
}

export class ProductionCycleDraftRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ format: 'uuid' }) farmId!: string;
  @ApiProperty({ format: 'uuid' }) plotId!: string;
  @ApiProperty({ format: 'uuid' }) productId!: string;
  @ApiProperty({ format: 'uuid', nullable: true }) seedMaterialId!: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) responsibleUserId!: string | null;
  @ApiProperty({ nullable: true }) cultivationMethod!: string | null;
  @ApiProperty() name!: string;
  @ApiProperty() cycleCode!: string;
  @ApiProperty({ format: 'date' }) startDate!: string;
  @ApiProperty({ format: 'date' }) plannedHarvest!: string;
  @ApiProperty() cultivatedArea!: string;
  @ApiProperty({ nullable: true }) maxHarvestQuantity!: string | null;
  @ApiProperty() harvestUnit!: string;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class ProductionCycleDraftListDto {
  @ApiProperty({ type: [ProductionCycleDraftRecordDto] }) items!: ProductionCycleDraftRecordDto[];
}

export class VersionedCommandDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}

export class PlantCycleDto extends VersionedCommandDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  plantedAt!: string;
}

export class CareRecordDto extends VersionedCommandDto {
  @ApiProperty({type:String,maxLength:255}) @IsString() @MinLength(1) @MaxLength(255) name!:string;
  @ApiProperty({required:false,format:'uuid'}) @IsOptional() @IsUUID() materialId?:string;
  @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) activeIngredient?:string;
  @ApiProperty({required:false,maxLength:255}) @IsOptional() @IsString() @MaxLength(255) applicationArea?:string;
  @ApiProperty({required:false,minimum:0,maximum:3650}) @IsOptional() @Type(()=>Number) @IsInt() @Min(0) @Max(3650) withdrawalPeriod?:number;
  @ApiProperty({format:'uuid'}) @IsUUID() evidenceRef!:string;
  @ApiProperty({ type: [String], format: 'uuid', required: false, maxItems: 4 })
  @IsOptional() @IsArray() @ArrayMaxSize(4) @ArrayUnique() @IsUUID('4', { each: true })
  additionalEvidenceRefs?: string[];
  @ApiProperty({ type: String, maxLength: 100 })
  @IsString()
  @MaxLength(100)
  careType!: string;
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  eventTime!: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  materialName?: string;
  @ApiProperty({
    type: Number,
    required: false,
    minimum: 0,
    exclusiveMinimum: true,
    multipleOf: 0.001,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity?: number;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  unit?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  method?: string;
  @ApiProperty({ type: String, format: 'uuid', required: false, description: 'Defaults to the recording account; may be the member assigned to the cycle' })
  @IsOptional() @IsUUID() performerUserId?: string;
  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) cropCondition?: string;
  @ApiProperty({ type: String, required: false })
  @IsOptional()
  @IsString()
  note?: string;
}

export class SensorReadingDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  deviceId!: string;
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

export class CancelCycleDto extends VersionedCommandDto {
  @ApiProperty({ type: String, maxLength: 500 })
  @IsString()
  @MaxLength(500)
  reason!: string;
}

export class ReconcileCycleSensorDto extends VersionedCommandDto {
  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  plantedAt!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  throughHarvestId?: string;
  @ApiProperty({ type: String, maxLength: 1000, minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  reason!: string;
}
