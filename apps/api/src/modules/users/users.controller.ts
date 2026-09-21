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
  constructor(private readonly service: UsersService) {}
  @Get() list() {
    return this.service.list();
  }
  @Get('roles') roles() {
    return this.service.roles();
  }
  @Post() create(@Body() input: CreateUserDto) {
    return this.service.create(input);
  }
  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateUserStatusDto,
  ) {
    return this.service.updateStatus(id, input);
  }
}
