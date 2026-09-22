import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { BlockchainProofQueryService } from './blockchain-proof-query.service.js';

@ApiTags('blockchain')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('blockchain')
export class BlockchainController {
  constructor(private readonly proofs: BlockchainProofQueryService) {}

  @Get('events/:eventId/verify')
  verify(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.proofs.verify(eventId);
  }
}
