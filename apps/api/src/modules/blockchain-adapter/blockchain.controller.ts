import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BlockchainProofQueryService } from './blockchain-proof-query.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { VerifyProofDto } from '../../common/api/response.dto.js';

@ApiTags('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly proofs: BlockchainProofQueryService) {}

  @Get('events/:eventId/verify')
  // Authenticated, read-only proof checks: an auditor or the release smoke
  // verifies many events in a row, beyond the general 120/min per client.
  @Throttle({ default: { limit: 1200, ttl: 60_000 } })
  @ApiDataResponse(VerifyProofDto)
  verify(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.proofs.verify(eventId, req.user);
  }
}
