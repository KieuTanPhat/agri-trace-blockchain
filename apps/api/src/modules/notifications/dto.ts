import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  NotificationSeverity,
  NotificationStatus,
  NotificationType,
} from '../../generated/prisma/client.js';

export class CreateSensorAlertRuleDto {
  @IsUUID()
  organizationId!: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsString()
  @MaxLength(100)
  sensorType!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minimumValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maximumValue?: number;

  @IsOptional()
  @IsEnum(NotificationSeverity)
  severity?: NotificationSeverity;
}

export class UpdateSensorAlertRuleDto {
  @IsOptional()
  @IsUUID()
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sensorType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  minimumValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  maximumValue?: number;

  @IsOptional()
  @IsEnum(NotificationSeverity)
  severity?: NotificationSeverity;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
