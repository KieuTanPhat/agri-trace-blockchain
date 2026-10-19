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
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import {
  EnterpriseConnectionDto,
  EnterpriseConnectionViewDto,
  EnterpriseEnrollmentViewDto,
  ReviewEnterpriseDto,
  ActivateEnterpriseDto,
} from './dto.js';
import { EnterpriseOnboardingService } from './enterprise-onboarding.service.js';
import { EnterpriseOnboardingGuard } from './enterprise-onboarding.guard.js';

@ApiTags('enterprise-onboarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EnterpriseOnboardingGuard)
@Controller()
export class EnterpriseOnboardingController {
  constructor(
    private readonly service: EnterpriseOnboardingService,
    private readonly idem: IdempotencyService,
  ) {}
  @Get('enterprise-enrollments/mine')
  @ApiDataResponse(EnterpriseEnrollmentViewDto)
  mine(@Req() req: AuthenticatedRequest) {
    return this.service.mine(req.user);
  }
  @Get('enterprise-enrollments')
  @ApiDataResponse(EnterpriseEnrollmentViewDto, 200, true)
  list(@Req() req: AuthenticatedRequest) {
    return this.service.list(req.user);
  }
  @Get('enterprise-enrollments/:id')
  @ApiDataResponse(EnterpriseEnrollmentViewDto)
  find(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.find(req.user, id);
  }
  @Post('enterprise-enrollments/:id/review')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(EnterpriseEnrollmentViewDto, 201)
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReviewEnterpriseDto,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_REVIEW',
        requestType: 'COMMAND',
        payload: { id, ...input },
      },
      () => this.service.review(req.user, id, input),
    );
  }
  @Post('enterprise-enrollments/:id/activate') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(EnterpriseEnrollmentViewDto,201)
  activate(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() input:ActivateEnterpriseDto,@IdempotencyKey() key:string){
    return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,operation:'ENTERPRISE_ACTIVATE',requestType:'COMMAND',payload:{id,...input}},()=>this.service.activate(req.user,id,input));
  }
  @Post('enterprise-connections')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(EnterpriseConnectionViewDto, 201)
  connect(
    @Req() req: AuthenticatedRequest,
    @Body() input: EnterpriseConnectionDto,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_CONNECT',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.connect(req.user, input),
    );
  }
  @Post('enterprise-connections/:id/review')
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiDataResponse(EnterpriseConnectionViewDto, 201)
  reviewConnection(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReviewEnterpriseDto,
    @IdempotencyKey() key: string,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'ENTERPRISE_CONNECTION_REVIEW',
        requestType: 'COMMAND',
        payload: { id, ...input },
      },
      () => this.service.reviewConnection(req.user, id, input),
    );
  }
}
