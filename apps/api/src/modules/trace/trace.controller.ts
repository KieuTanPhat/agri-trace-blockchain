import { ApiDataResponse } from '../../common/api/openapi.js';
import {
  TraceHistoryDto,
  TraceProofDto,
} from '../../common/api/response.dto.js';
import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TraceService } from './trace.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';

@ApiTags('trace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @ApiDataResponse(TraceHistoryDto, 200, true)
  @Get('lots/:lotId')
  getLotHistory(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.trace.getLotHistory(lotId, req.user);
  }

  @ApiDataResponse(TraceProofDto, 200)
  @Get('events/:eventId/proof')
  getProof(
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.trace.getProof(eventId, req.user);
  }
}
