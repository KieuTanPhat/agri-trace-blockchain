import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TraceService } from './trace.service.js';

@ApiTags('trace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Get('lots/:lotId')
  getLotHistory(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.trace.getLotHistory(lotId, req.user);
  }

  @Get('events/:eventId/proof')
  getProof(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.trace.getProof(eventId, req.user);
  }
}