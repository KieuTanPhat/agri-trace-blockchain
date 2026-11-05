import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class EnterpriseAuditQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Employee name or email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Matches(/^[A-Z][A-Z0-9_]{0,99}$/)
  action?: string;
  @ApiPropertyOptional({ enum: ['SUCCESS', 'DENIED', 'FAILED'] })
  @IsOptional()
  @IsIn(['SUCCESS', 'DENIED', 'FAILED'])
  outcome?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;
  @ApiPropertyOptional({ maxLength: 1024 })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  cursor?: string;
  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class EnterpriseAuditEmployeeDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() fullName!: string;
  @ApiProperty() email!: string;
}
export class EnterpriseAuditEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'date-time', type: String }) occurredAt!: Date;
  @ApiProperty({ type: EnterpriseAuditEmployeeDto })
  employee!: EnterpriseAuditEmployeeDto;
  @ApiProperty() action!: string;
  @ApiProperty({ enum: ['SUCCESS', 'DENIED', 'FAILED'] }) outcome!: string;
  @ApiProperty({ enum: ['ACTIVITY', 'ACCOUNT'] }) category!: string;
}
export class EnterpriseAuditPageDto {
  @ApiProperty({ type: EnterpriseAuditEntryDto, isArray: true })
  items!: EnterpriseAuditEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
