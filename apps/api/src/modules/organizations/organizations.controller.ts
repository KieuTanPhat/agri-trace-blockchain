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
import { CreateOrganizationDto, UpdateOrganizationDto } from './dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly service: OrganizationsService,
    private readonly idem: IdempotencyService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Roles('SYSTEM_ADMIN')
  @Post()
  create(
    @Body() input: CreateOrganizationDto,
    @IdempotencyKey() key: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.idem.executeCommand(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        actor: req.user,
        responseStatus: 201,
        operation: 'CREATE_ORGANIZATIONS',
        requestType: 'COMMAND',
        payload: input,
      },
      () => this.service.create(input),
    );
  }

  @Roles('SYSTEM_ADMIN')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateOrganizationDto,
  ) {
    return this.service.update(id, input);
  }
}
