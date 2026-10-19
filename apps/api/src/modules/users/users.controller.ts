import { ApiHeader } from '@nestjs/swagger';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { RoleRecordDto } from '../../common/api/record.dto.js';
import {
  UserListDto,
  UserCreatedDto,
  UserSessionsRevokedDto,
  UserStatusDto,
} from '../../common/api/response.dto.js';
import { Req } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import {
  CreateUserDto,
  ResetUserPasswordDto,
  RevokeUserSessionsDto,
  UnlockUserDto,
  UpdateUserStatusDto,
} from './dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN')
@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly idem: IdempotencyService,
  ) {}

  private command<T>(
    req: AuthenticatedRequest,
    key: string,
    operation: string,
    payload: object,
    work: () => Promise<T>,
    responseStatus = 200,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus,
        operation,
        requestType: 'COMMAND',
        payload,
      },
      work,
    );
  }

  @ApiDataResponse(UserListDto, 200, true)
  @Get()
  list() {
    return this.service.list();
  }
  @ApiDataResponse(RoleRecordDto, 200, true)
  @Get('roles')
  roles() {
    return this.service.roles();
  }
  @ApiDataResponse(UserCreatedDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  create(
    @Body() input: CreateUserDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(
      req,
      key,
      'CREATE_USERS',
      input,
      () => this.service.create(req.user, input),
      201,
    );
  }
  @ApiDataResponse(UserStatusDto, 200)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateUserStatusDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(req, key, 'PLATFORM_USER_STATUS', { ...input, id }, () =>
      this.service.updateStatus(req.user, id, input),
    );
  }
  @ApiDataResponse(UserStatusDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/unlock')
  unlock(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UnlockUserDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_USER_UNLOCK',
      { ...input, id },
      () => this.service.unlock(req.user, id, input),
      201,
    );
  }
  @ApiDataResponse(UserSessionsRevokedDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/revoke-sessions')
  revokeSessions(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: RevokeUserSessionsDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_USER_REVOKE_SESSIONS',
      { ...input, id },
      () => this.service.revokeSessions(req.user, id, input),
      201,
    );
  }
  @ApiDataResponse(UserStatusDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ResetUserPasswordDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.command(
      req,
      key,
      'PLATFORM_USER_RESET_PASSWORD',
      { ...input, id },
      () => this.service.resetPassword(req.user, id, input),
      201,
    );
  }
}
