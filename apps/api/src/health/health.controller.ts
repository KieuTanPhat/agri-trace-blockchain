import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
  live() {
    return {
      status: 'ok',
      service: 'agri-trace-blockchain-api',
      timestamp: new Date().toISOString(),
    };
  }
}
