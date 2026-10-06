import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BlockchainWorkerService } from './blockchain-worker.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

@ApiTags('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly worker: BlockchainWorkerService) {}
  @Get('events/:eventId/verify')
  verify(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.worker.verify(eventId, req.user);
  }
  @Roles('SYSTEM_ADMIN')
  @Post('worker/run')
  run() {
    return this.worker.processPending();
  }
}
