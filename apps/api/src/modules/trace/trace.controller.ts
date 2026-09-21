import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TraceService } from './trace.service.js';

@ApiTags('trace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('trace')
export class TraceController {
  constructor(private readonly trace: TraceService) {}

  @Get('lots/:lotId')
  getLotHistory(@Param('lotId', ParseUUIDPipe) lotId: string) {
    return this.trace.getLotHistory(lotId);
  }

  @Get('events/:eventId/proof')
  getProof(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.trace.getProof(eventId);
  }
}
