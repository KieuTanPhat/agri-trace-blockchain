import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class HistoryQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() productId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() harvestId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
}
export class MediaTarget {
  @IsIn(['LOT', 'PRODUCT', 'CERTIFICATE']) targetType!: string;
  @IsUUID() targetId!: string;
}
export class MediaVisibility {
  @IsBoolean() isPublic!: boolean;
}
