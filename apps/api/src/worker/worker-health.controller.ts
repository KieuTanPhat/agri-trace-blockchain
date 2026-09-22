import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlockchainWorkerRunner } from '../modules/blockchain-adapter/blockchain-worker.runner.js';

@Controller('health')
export class WorkerHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: BlockchainWorkerRunner,
  ) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'agri-trace-blockchain-worker',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [pending, retry, deadLetter] = await Promise.all([
        this.prisma.blockchainOutbox.count({ where: { status: 'PENDING' } }),
        this.prisma.blockchainOutbox.count({ where: { status: 'RETRY' } }),
        this.prisma.blockchainOutbox.count({
          where: { status: 'DEAD_LETTER' },
        }),
      ]);
      return {
        status: 'ok',
        service: 'agri-trace-blockchain-worker',
        runtime: this.runner.getState(),
        backlog: { pending, retry, deadLetter },
        timestamp: new Date().toISOString(),
      };
    } catch {
      throw new ServiceUnavailableException('Worker database is unavailable');
    }
  }
}
