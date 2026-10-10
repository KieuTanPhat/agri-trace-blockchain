import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiDataResponse } from '../common/api/openapi.js';
import { HealthDto } from './health.dto.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiDataResponse(HealthDto)
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('API database is unavailable');
    }
    return {
      status: 'ok',
      service: 'agri-trace-blockchain-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('live')
  @ApiDataResponse(HealthDto)
  live() {
    return {
      status: 'ok',
      service: 'agri-trace-blockchain-api',
      timestamp: new Date().toISOString(),
    };
  }
}
