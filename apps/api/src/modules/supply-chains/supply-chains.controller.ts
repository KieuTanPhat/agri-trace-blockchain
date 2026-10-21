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
import { IsOptional, IsUUID } from 'class-validator';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SupplyChainsService } from './supply-chains.service.js';
import {
  CapabilityDto,
  CapabilityRecordDto,
  ChainContextDto,
  ChainRecordDto,
  ChainVersionDto,
  ChangeMemberDto,
  CreateChainDto,
  SuspendChainDto,
  GrantRecordDto,
  GrantRoleDto,
  InviteMemberDto,
  MemberRecordDto,
  ScopedUserDto,
  BusinessProfileDto,
  LedgerStatusDto,
} from './dto.js';

export class RevokeGrantDto extends ChainVersionDto {
  @ApiProperty({ type: String, required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  chainId?: string;
}

@ApiTags('supply-chains')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class SupplyChainsController {
  constructor(
    private readonly service: SupplyChainsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get('chain-permissions')
  @ApiDataResponse(ChainContextDto)
  context(@Req() req: AuthenticatedRequest) {
    return this.service.context(req.user);
  }

  @Get('organizations/:organizationId/scoped-users')
  @ApiDataResponse(ScopedUserDto, 200, true)
  users(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.service.users(req.user, organizationId);
  }

  @Get('supply-chains')
  @ApiDataResponse(ChainRecordDto, 200, true)
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }

  @Get('organizations/:organizationId/scoped-grants')
  @ApiDataResponse(GrantRecordDto, 200, true)
  grants(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
  ) {
    return this.service.grants(req.user, organizationId);
  }

  @Get('supply-chains/:chainId')
  @ApiDataResponse(ChainRecordDto)
  get(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) id: string,
  ) {
    return this.service.get(req.user, id);
  }

  @Get('supply-chains/:chainId/ledger-status')
  @ApiDataResponse(LedgerStatusDto)
  ledgerStatus(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) id: string,
  ) {
    return this.service.ledgerStatus(req.user, id);
  }

  @Get('supply-chains/:chainId/memberships')
  @ApiDataResponse(MemberRecordDto, 200, true)
  members(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) id: string,
  ) {
    return this.service.members(req.user, id);
  }

  @Post('supply-chains')
  @ApiDataResponse(ChainRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  create(
    @Req() req: AuthenticatedRequest,
    @Body() input: CreateChainDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(req, key, 'HYB_CREATE_CHAIN', input, () =>
      this.service.create(req.user, input),
    );
  }

  @Get('supply-chains/:chainId/business-profile')
  @ApiDataResponse(BusinessProfileDto)
  profile(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
  ) {
    return this.service.businessProfile(req.user, chainId);
  }

  @Post('supply-chains/:chainId/business-profile/activate')
  @ApiDataResponse(BusinessProfileDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  activate(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() input: ChainVersionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_ACTIVATE_BUSINESS_PROFILE',
      { ...input, chainId },
      () =>
        this.service.activateBusinessProfile(req.user, chainId, input.version),
    );
  }

  @Post('supply-chains/:chainId/business-profile/suspend')
  @ApiDataResponse(BusinessProfileDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  suspend(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() input: SuspendChainDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(req, key, 'HYB_SUSPEND_BUSINESS_PROFILE', { ...input, chainId }, () =>
      this.service.suspendBusinessProfile(req.user, chainId, input.version, input.reason),
    );
  }

  @Post('supply-chains/:chainId/memberships')
  @ApiDataResponse(MemberRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  invite(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Body() input: InviteMemberDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_INVITE_MEMBERSHIP',
      { ...input, chainId },
      () => this.service.invite(req.user, chainId, input.organizationId),
    );
  }

  @Post('supply-chains/:chainId/memberships/:organizationId/accept')
  @ApiDataResponse(MemberRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  accept(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: ChainVersionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_ACCEPT_MEMBERSHIP',
      { ...input, chainId, organizationId },
      () =>
        this.service.changeMember(
          req.user,
          chainId,
          organizationId,
          input.version,
          'ACTIVE',
        ),
    );
  }

  @Post('supply-chains/:chainId/memberships/:organizationId/status')
  @ApiDataResponse(MemberRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  change(
    @Req() req: AuthenticatedRequest,
    @Param('chainId', ParseUUIDPipe) chainId: string,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: ChangeMemberDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_CHANGE_MEMBERSHIP',
      { ...input, chainId, organizationId },
      () =>
        this.service.changeMember(
          req.user,
          chainId,
          organizationId,
          input.version,
          input.status,
        ),
    );
  }

  @Post('organizations/:organizationId/scoped-grants')
  @ApiDataResponse(GrantRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  grant(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: GrantRoleDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_GRANT_ROLE',
      { ...input, organizationId },
      () => this.service.grant(req.user, organizationId, input),
    );
  }

  @Post('organizations/:organizationId/scoped-grants/:grantId/revoke')
  @ApiDataResponse(GrantRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  revoke(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() input: RevokeGrantDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_REVOKE_ROLE',
      { ...input, organizationId, grantId },
      () =>
        this.service.revokeGrant(
          req.user,
          organizationId,
          grantId,
          input.chainId,
          input.version,
        ),
    );
  }

  @Post('organizations/:organizationId/capabilities')
  @ApiDataResponse(CapabilityRecordDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  capability(
    @Req() req: AuthenticatedRequest,
    @Param('organizationId', ParseUUIDPipe) organizationId: string,
    @Body() input: CapabilityDto,
    @IdempotencyKey() key: string,
  ) {
    return this.command(
      req,
      key,
      'HYB_SET_CAPABILITY',
      { ...input, organizationId },
      () => this.service.capability(req.user, organizationId, input.code),
    );
  }

  private command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        operation,
        requestType: 'COMMAND',
        responseStatus: 201,
        payload,
      },
      work,
    );
  }
}
