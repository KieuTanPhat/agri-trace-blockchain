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
import { CreateUserDto, UpdateUserStatusDto } from './dto.js';
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
  @Get() list() {
    return this.service.list();
  }
  @Get('roles') roles() {
    return this.service.roles();
  }
  @Post() create(
    @Body() input: CreateUserDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idem.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'CREATE_USERS',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.create(input),
    );
  }
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateUserStatusDto,
  ) {
    return this.service.updateStatus(id, input);
  }
}
