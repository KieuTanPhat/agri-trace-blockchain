import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { EnterpriseWorkspaceService } from './enterprise-workspace.service.js';
import {
  EnterpriseMemberInput,
  EnterpriseMemberUpdate,
  MemberSupervisorInput,
  EnterprisePartnerDecision,
  EnterprisePartnerInput,
  EnterpriseExternalPartnerInput,
  EnterpriseRoleInput,
  EnterpriseSiteInput,
  EnterpriseVehicleInput,
  ResourceStatusInput,
  WorkspaceRecordDto,
} from './dto.js';
import {
  EnterpriseMemberListDto,
  EnterprisePartnerListDto,
  ExternalPartnerListDto,
  PartnerSearchListDto,
  EnterpriseRoleListDto,
  EnterpriseRoleTemplateListDto,
  EnterpriseSiteListDto,
  EnterpriseVehicleListDto,
  WorkspaceOverviewDto,
} from './workspace-response.dto.js';

@ApiTags('enterprise-workspace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('enterprise-workspace')
export class EnterpriseWorkspaceController {
  constructor(
    private readonly service: EnterpriseWorkspaceService,
    private readonly idem: IdempotencyService,
  ) {}
  private run(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: unknown,
    fn: () => Promise<unknown>,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation,
        payload,
        requestType: 'COMMAND',
      },
      fn,
    );
  }
  @Get() @ApiDataResponse(WorkspaceOverviewDto) overview(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.overview(req.user);
  }
  @Get('members') @ApiDataResponse(EnterpriseMemberListDto) members(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.members(req.user);
  }
  @Get('roles') @ApiDataResponse(EnterpriseRoleListDto) roles(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.roles(req.user);
  }
  @Get('role-templates') @ApiDataResponse(EnterpriseRoleTemplateListDto) roleTemplates(@Req() req: AuthenticatedRequest) {
    return this.service.roleTemplates(req.user);
  }
  @Get('partners') @ApiDataResponse(EnterprisePartnerListDto) partners(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.partners(req.user);
  }
  @Get('partners/search') @ApiDataResponse(PartnerSearchListDto) searchPartners(
    @Req() req: AuthenticatedRequest, @Query('q') query = '',
  ) {
    return this.service.searchPartners(req.user, query);
  }
  @Get('partners/external') @ApiDataResponse(ExternalPartnerListDto) externalPartners(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.externalPartners(req.user);
  }
  @Get('sites') @ApiDataResponse(EnterpriseSiteListDto) sites(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.sites(req.user);
  }
  @Get('vehicles') @ApiDataResponse(EnterpriseVehicleListDto) vehicles(
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.vehicles(req.user);
  }
  @Post('members')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  createMember(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterpriseMemberInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CREATE_MEMBER', dto, () =>
      this.service.createMember(req.user, dto),
    );
  }
  @Post('members/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  updateMember(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterpriseMemberUpdate,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_UPDATE_MEMBER', { id, ...dto }, () =>
      this.service.updateMember(req.user, id, dto),
    );
  }
  @Post('members/:id/supervisor')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  changeMemberSupervisor(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MemberSupervisorInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CHANGE_MEMBER_SUPERVISOR', { id, ...dto }, () =>
      this.service.changeSupervisor(req.user, id, dto),
    );
  }
  @Post('roles')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  createRole(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterpriseRoleInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CREATE_ROLE', dto, () =>
      this.service.saveRole(req.user, dto),
    );
  }
  @Post('roles/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  updateRole(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterpriseRoleInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_UPDATE_ROLE', { id, ...dto }, () =>
      this.service.saveRole(req.user, dto, id),
    );
  }
  @Post('partners')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  invite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterprisePartnerInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_INVITE_PARTNER', dto, () =>
      this.service.invitePartner(req.user, dto),
    );
  }
  @Post('partners/external')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  createExternalPartner(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterpriseExternalPartnerInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CREATE_EXTERNAL_PARTNER', dto, () =>
      this.service.createExternalPartner(req.user, dto),
    );
  }
  @Post('partners/:id')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  resolve(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EnterprisePartnerDecision,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_RESOLVE_PARTNER', { id, ...dto }, () =>
      this.service.resolvePartner(req.user, id, dto),
    );
  }
  @Post('sites')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  createSite(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterpriseSiteInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CREATE_SITE', dto, () =>
      this.service.createSite(req.user, dto),
    );
  }
  @Post('vehicles')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  createVehicle(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EnterpriseVehicleInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_CREATE_VEHICLE', dto, () =>
      this.service.createVehicle(req.user, dto),
    );
  }
  @Post('sites/:id/status')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  siteStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResourceStatusInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_UPDATE_SITE', { id, ...dto }, () =>
      this.service.status(req.user, 'site', id, dto),
    );
  }
  @Post('vehicles/:id/status')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(WorkspaceRecordDto, 201)
  vehicleStatus(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResourceStatusInput,
    @IdempotencyKey() key: string,
  ) {
    return this.run(req, key, 'EW_UPDATE_VEHICLE', { id, ...dto }, () =>
      this.service.status(req.user, 'vehicle', id, dto),
    );
  }
}
