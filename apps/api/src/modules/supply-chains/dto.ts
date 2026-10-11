import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ChainVersionDto {
  @ApiProperty({ type: Number, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  version!: number;
}
export class CreateChainDto {
  @ApiProperty({ type: String, maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;
}
export class InviteMemberDto {
  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  organizationId!: string;
}
export class ChangeMemberDto extends ChainVersionDto {
  @ApiProperty({ enum: ['SUSPENDED', 'REVOKED', 'INVITED'] })
  @IsIn(['SUSPENDED', 'REVOKED', 'INVITED'])
  status!: 'SUSPENDED' | 'REVOKED' | 'INVITED';
}
export class GrantRoleDto {
  @ApiProperty({ type: String, format: 'uuid' }) @IsUUID() userId!: string;
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  chainId?: string;
  @ApiProperty({
    enum: [
      'ORG_ADMIN',
      'CREATE_CHAIN',
      'CHAIN_MANAGER',
      'FARM_STAFF',
      'TRANSPORTER',
      'RETAILER',
      'AUDITOR',
      'COMPLIANCE_REVIEWER',
    ],
  })
  @IsIn([
    'ORG_ADMIN',
    'CREATE_CHAIN',
    'CHAIN_MANAGER',
    'FARM_STAFF',
    'TRANSPORTER',
    'RETAILER',
    'AUDITOR',
    'COMPLIANCE_REVIEWER',
  ])
  role!:
    | 'ORG_ADMIN'
    | 'CREATE_CHAIN'
    | 'CHAIN_MANAGER'
    | 'FARM_STAFF'
    | 'TRANSPORTER'
    | 'RETAILER'
    | 'AUDITOR'
    | 'COMPLIANCE_REVIEWER';
}
export class CapabilityDto {
  @ApiProperty({ enum: ['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'] })
  @IsIn(['FARM', 'TRANSPORTER', 'RETAILER', 'AUDITOR'])
  code!: 'FARM' | 'TRANSPORTER' | 'RETAILER' | 'AUDITOR';
}
export class ChainRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) ownerOrganizationId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class MemberRecordDto {
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED'] })
  status!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: Number }) invitationRevision!: number;
}
export class GrantRecordDto {
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) chainId!:
    string | null;
  @ApiProperty({ type: String }) scope!: string;
  @ApiProperty({ type: String }) role!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  revokedAt!: string | null;
}
export class CapabilityRecordDto {
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: Number }) revision!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  revokedAt!: string | null;
}
export class ChainContextDto {
  @ApiProperty({ type: [GrantRecordDto] }) grants!: GrantRecordDto[];
  @ApiProperty({ type: [MemberRecordDto] }) memberships!: MemberRecordDto[];
  @ApiProperty({ type: [CapabilityRecordDto] })
  capabilities!: CapabilityRecordDto[];
}

export class ScopedUserDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fullName!: string;
}
