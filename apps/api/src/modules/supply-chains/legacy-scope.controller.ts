import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  applyLegacyScopeRoot,
  authorizeLegacyScopeCommand,
  confirmLegacyScopeProposal,
  legacyReviewKeys,
  registerLegacyScopeManifest,
} from './legacy-scope.commands.js';
import { requireLegacyScopePin } from './legacy-scope-pins.js';

class LegacyConsentDto {
  @ApiProperty({ type: String, pattern: '^[a-f0-9]{64}$' })
  @Matches(/^[a-f0-9]{64}$/)
  proposalKey!: string;
}
class LegacyResultDto {
  @ApiProperty({ type: String, format: 'uuid' }) manifestId!: string;
}
class LegacyRegistrationResultDto extends LegacyResultDto {
  @ApiProperty({ type: String }) digest!: string;
}
class LegacyConsentResultDto extends LegacyResultDto {
  @ApiProperty({ type: String }) proposalKey!: string;
  @ApiProperty({ type: Boolean }) accepted!: boolean;
}
class LegacyApplyResultDto extends LegacyResultDto {
  @ApiProperty({ type: String, format: 'uuid' }) cycleId!: string;
  @ApiProperty({ type: String }) checkpointDigest!: string;
  @ApiProperty({ type: Boolean }) applied!: boolean;
}
class LegacyProposalDto {
  @ApiProperty({ type: String }) key!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ enum: ['PRODUCTION', 'TRANSPORT', 'RETAIL', 'REVIEW'] })
  stage!: string;
  @ApiProperty({ type: String }) manifestDigest!: string;
  @ApiProperty({ type: String }) planDigest!: string;
  @ApiProperty({
    type: String,
    description: 'Mã đối tượng công đoạn hoặc chuỗi cần review',
  })
  subjectId!: string;
}

@ApiTags('legacy-scope')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('legacy-scope/manifests/:manifestId')
export class LegacyScopeController {
  constructor(
    private readonly db: PrismaService,
    private readonly idem: IdempotencyService,
  ) {}
  private command(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: Parameters<typeof commandTransaction>[1],
  ) {
    return this.idem.executeCommand(
      {
        actor: req.user,
        requesterId: req.user.sub,
        idempotencyKey: key,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload,
      },
      () =>
        commandTransaction(this.db, work, { maxWait: 5000, timeout: 120000 }),
    );
  }
  @Post('register')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(LegacyRegistrationResultDto, 201)
  register(
    @Req() req: AuthenticatedRequest,
    @Param('manifestId', ParseUUIDPipe) manifestId: string,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_REGISTER_LEGACY_MANIFEST',
      { manifestId },
      (tx) => registerLegacyScopeManifest(tx, req.user, manifestId),
    );
  }
  @Get('proposals')
  @ApiDataResponse(LegacyProposalDto, 200, true)
  async proposals(
    @Req() req: AuthenticatedRequest,
    @Param('manifestId', ParseUUIDPipe) manifestId: string,
  ) {
    const pin = requireLegacyScopePin(manifestId);
    const proposed = [
      ...pin.plan.proposals.map((p) => ({
        key: p.key,
        chainId: p.chainId,
        stage: p.stage,
        subjectId: p.subject.id,
      })),
      ...Object.entries(legacyReviewKeys(pin)).map(([key, chainId]) => ({
        key,
        chainId,
        stage: 'REVIEW',
        subjectId: chainId,
      })),
    ];
    const visible = [];
    for (const p of proposed) {
      try {
        await authorizeLegacyScopeCommand(this.db, {
          actor: req.user,
          requesterId: req.user.sub,
          operation: 'SCOPE_CONFIRM_LEGACY_ASSIGNMENT',
          payload: { manifestId, proposalKey: p.key },
        });
        visible.push({
          ...p,
          manifestDigest: pin.digest,
          planDigest: pin.plan.digest,
        });
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !('status' in error) ||
          ![403, 404].includes(Number(error.status))
        )
          throw error;
      }
    }
    return visible;
  }
  @Post('confirm')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(LegacyConsentResultDto, 201)
  confirm(
    @Req() req: AuthenticatedRequest,
    @Param('manifestId', ParseUUIDPipe) manifestId: string,
    @Body() dto: LegacyConsentDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_CONFIRM_LEGACY_ASSIGNMENT',
      { manifestId, proposalKey: dto.proposalKey },
      (tx) =>
        confirmLegacyScopeProposal(tx, req.user, manifestId, dto.proposalKey),
    );
  }
  @Post('roots/:cycleId/apply')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(LegacyApplyResultDto, 201)
  apply(
    @Req() req: AuthenticatedRequest,
    @Param('manifestId', ParseUUIDPipe) manifestId: string,
    @Param('cycleId', ParseUUIDPipe) cycleId: string,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'SCOPE_APPLY_LEGACY_ROOT',
      { manifestId, cycleId },
      (tx) => applyLegacyScopeRoot(tx, req.user, manifestId, cycleId),
    );
  }
}
