import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type {
  OrganizationType,
  Prisma,
} from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import {
  BUSINESS_ACTIVITIES,
  RegistrationProcessingDetails,
  RegistrationProductionDetails,
  chainOwner,
  mayOwnChains,
} from './registration-profile.dto.js';
import { appendPlatformAudit } from '../platform-governance/platform-audit.js';

export class ParticipationUpgradeInput {
  @ApiProperty({ minimum: 0, description: 'Current enrollment version' })
  @IsInt()
  @Min(0)
  version!: number;
}

export class CapabilityAddInput {
  @ApiProperty({ enum: BUSINESS_ACTIVITIES })
  @IsIn(BUSINESS_ACTIVITIES)
  code!: (typeof BUSINESS_ACTIVITIES)[number];
  @ApiPropertyOptional({ type: RegistrationProductionDetails })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationProductionDetails)
  production?: RegistrationProductionDetails;
  @ApiPropertyOptional({ type: RegistrationProcessingDetails })
  @IsOptional()
  @ValidateNested()
  @Type(() => RegistrationProcessingDetails)
  processing?: RegistrationProcessingDetails;
  @ApiPropertyOptional({ type: [String], format: 'uuid', maxItems: 10, description: 'PROFILE certificates of the organization' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  evidenceIds?: string[];
}

type Tx = Prisma.TransactionClient;

async function ownedEnrollment(tx: Tx, actor: CommandActor) {
  const row = await tx.enterpriseEnrollment.findUnique({
    where: { ownerId: actor.sub! },
    include: { organization: { include: { capabilities: { where: { revokedAt: null } } } } },
  });
  if (!row || row.organizationId !== actor.organizationId)
    throw new ForbiddenException('Chỉ quản trị viên cấp 1 có hồ sơ đăng ký được thực hiện');
  if (row.status !== 'APPROVED')
    throw new ConflictException('Hồ sơ cần được duyệt trước');
  return row;
}

/** A member becomes a chain owner keeping its account and data; it then
 * chooses and pays a plan through the existing service order (ADR-005). */
export async function upgradeToChainOwner(
  tx: Tx,
  actor: CommandActor,
  input: ParticipationUpgradeInput,
) {
  const row = await ownedEnrollment(tx, actor);
  await tx.$queryRaw`SELECT organization_id FROM organization WHERE organization_id=${row.organizationId}::uuid FOR UPDATE`;
  if (row.version !== input.version)
    throw new ConflictException('Hồ sơ đã thay đổi; tải lại trước khi nâng cấp');
  if (chainOwner(row.organization.participationStatus))
    throw new ConflictException('Tổ chức đã là chủ chuỗi');
  const codes = row.organization.capabilities.map((c) => c.code);
  if (!mayOwnChains(codes))
    throw new ConflictException(
      'Chủ chuỗi cần ít nhất một năng lực sở hữu hàng đã được duyệt (sản xuất, chế biến, phân phối hoặc bán lẻ)',
    );
  await tx.organization.update({
    where: { id: row.organizationId },
    data: { participationStatus: 'CHAIN_OWNER', updatedAt: new Date() },
  });
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'PARTICIPATION_UPGRADED',
    subjectType: 'ORGANIZATION',
    subjectId: row.organizationId,
    organizationId: row.organizationId,
    reason: null,
    details: { from: 'MEMBER', to: 'CHAIN_OWNER' },
  });
  return { organizationId: row.organizationId, participationStatus: 'CHAIN_OWNER' };
}

/** An activated organization asks for another capability; review reuses the
 * per-capability admin review. */
export async function requestCapability(
  tx: Tx,
  actor: CommandActor,
  input: CapabilityAddInput,
) {
  const row = await ownedEnrollment(tx, actor);
  if (!row.serviceActivatedAt)
    throw new ConflictException('Tổ chức cần được kích hoạt trước khi xin thêm năng lực');
  if (row.organization.capabilities.some((c) => c.code === input.code))
    throw new ConflictException('Năng lực này đã có hiệu lực');
  if ((input.code === 'FARM') !== !!input.production)
    throw new BadRequestException('Khai báo thông tin sản xuất khi và chỉ khi xin năng lực sản xuất');
  if ((input.code === 'PROCESSOR') !== !!input.processing)
    throw new BadRequestException('Khai báo thông tin chế biến khi và chỉ khi xin năng lực chế biến');
  if (input.processing) {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
    if (input.processing.foodSafetyCertificateExpiry <= today)
      throw new BadRequestException('Giấy chứng nhận cơ sở đủ điều kiện an toàn thực phẩm phải còn hiệu lực');
  }
  const evidenceIds = input.evidenceIds ?? [];
  if (
    evidenceIds.length &&
    (await tx.traceEvidence.count({
      where: { id: { in: evidenceIds }, organizationId: row.organizationId, entityType: 'PROFILE' },
    })) !== evidenceIds.length
  )
    throw new ForbiddenException('Chọn chứng cứ hồ sơ của chính tổ chức');
  if (input.code === 'PROCESSOR' && !evidenceIds.length)
    throw new BadRequestException('Đính kèm giấy chứng nhận an toàn thực phẩm');
  if (
    await tx.capabilityRequest.findFirst({
      where: { organizationId: row.organizationId, code: input.code, status: { in: ['PENDING', 'APPROVED'] } },
    })
  )
    throw new ConflictException('Đã có yêu cầu năng lực này đang chờ hoặc đã duyệt');
  const request = await tx.capabilityRequest.create({
    data: {
      organizationId: row.organizationId,
      code: input.code as OrganizationType,
      details: JSON.parse(
        JSON.stringify(
          input.production ? { production: input.production } : input.processing ? { processing: input.processing } : {},
        ),
      ),
      evidenceIds,
    },
  });
  return { id: request.id, code: request.code, status: request.status, version: request.version };
}

export class ParticipationUpgradeView {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty({ enum: ['CHAIN_OWNER'] }) participationStatus!: string;
}
export class CapabilityAddView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES }) code!: string;
  @ApiProperty({ enum: ['PENDING'] }) status!: string;
  @ApiProperty({ minimum: 0 }) version!: number;
}
