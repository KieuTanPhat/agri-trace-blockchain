import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

export enum ReportGroupBy {
  DAY = 'DAY',
  MONTH = 'MONTH',
  PRODUCT = 'PRODUCT',
  ORGANIZATION = 'ORGANIZATION',
}

export class ActivityReportQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsEnum(ReportGroupBy)
  groupBy: ReportGroupBy = ReportGroupBy.DAY;
}