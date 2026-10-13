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
export class LedgerPermissionCountsDto {
  @ApiProperty({ type: Number }) active!: number;
  @ApiProperty({ type: Number, description: 'Chờ xác nhận trên ledger' })
  pending!: number;
  @ApiProperty({ type: Number, description: 'Đang thu hồi hoặc drain' })
  revoking!: number;
  @ApiProperty({ type: Number, description: 'Đang giữ để rà soát' })
  held!: number;
}
export class LedgerDeliveryCountsDto {
  @ApiProperty({ type: Number }) completed!: number;
  @ApiProperty({ type: Number }) pending!: number;
  @ApiProperty({ type: Number }) retry!: number;
  @ApiProperty({ type: Number }) deadLetter!: number;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  oldestPendingAt!: string | null;
  @ApiProperty({ type: Number, nullable: true }) pendingAgeSeconds!: number | null;
}
export class LedgerWorkerObservationDto {
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastCheckedAt!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) lastHealthyAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastErrorCode!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' }) certificateExpiresAt!: string | null;
  @ApiProperty({ type: Boolean }) heartbeatStale!: boolean;
  @ApiProperty({ type: Boolean }) certificateExpired!: boolean;
  @ApiProperty({ type: Boolean }) healthy!: boolean;
}
/** Trạng thái ledger của chuỗi. Không chứa endpoint, khóa hay descriptor quản trị. */
export class LedgerStatusDto {
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({
    enum: ['RELEASE_A', 'SERVICE', 'MANAGED_ORG', 'SELF_MANAGED_ORG'],
    description: 'RELEASE_A: chuỗi chưa có binding, giữ route cũ',
  })
  profile!: string;
  @ApiProperty({ type: String, nullable: true }) bindingStatus!: string | null;
  @ApiProperty({ type: String, nullable: true }) channelId!: string | null;
  @ApiProperty({ type: LedgerPermissionCountsDto })
  permissions!: LedgerPermissionCountsDto;
  @ApiProperty({ type: LedgerDeliveryCountsDto })
  delivery!: LedgerDeliveryCountsDto;
  @ApiProperty({ type: Number }) openHolds!: number;
  @ApiProperty({ type: Number }) pendingControlJobs!: number;
  @ApiProperty({ type: Number }) failedControlJobs!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastControlFailureAt!: string | null;
  @ApiProperty({ type: LedgerWorkerObservationDto }) worker!: LedgerWorkerObservationDto;
}
export class BusinessProfileDto {
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ enum: ['PREPARING', 'ACTIVE', 'SUSPENDED'] }) state!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: Number }) scopeVersion!: number;
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
  @ApiProperty({
    type: String,
    required: false,
    description: 'Revision để bỏ dữ liệu UI cũ; không là quyền command',
  })
  accessRevision?: string;
  @ApiProperty({ type: [GrantRecordDto] }) grants!: GrantRecordDto[];
  @ApiProperty({ type: [MemberRecordDto] }) memberships!: MemberRecordDto[];
  @ApiProperty({ type: [CapabilityRecordDto] })
  capabilities!: CapabilityRecordDto[];
  @ApiProperty({ type: [String], required: false }) businessChains?: string[];
  @ApiProperty({
    type: [ChainRecordDto],
    required: false,
    description: 'Chuỗi ACTIVE được cấp quyền sản xuất và capability hiện hành',
  })
  productionChains?: ChainRecordDto[];
}

export class ScopedUserDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fullName!: string;
}
