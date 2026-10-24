import { Controller, Get, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';
import { BlockchainWorkerRunner } from '../modules/blockchain-adapter/blockchain-worker.runner.js';

@Controller('health')
export class WorkerHealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: BlockchainWorkerRunner,
    @Optional() private readonly config?: ConfigService,
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
    const now = new Date();
    const runtime = this.runner.getState();
    const interval = this.positiveNumber('FABRIC_WORKER_INTERVAL_MS', 10_000);
    const maxAge = this.positiveNumber('WORKER_READY_MAX_AGE_MS', Math.max(60_000, interval * 3));
    let data;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      const [pending, retry, deadLetter, controlPending, bindings] = await Promise.all([
        this.prisma.blockchainOutbox.count({ where: { status: 'PENDING' } }),
        this.prisma.blockchainOutbox.count({ where: { status: 'RETRY' } }),
        this.prisma.blockchainOutbox.count({
          where: { status: 'DEAD_LETTER' },
        }),
        this.prisma.ledgerControlJob.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
        this.prisma.fabricNetworkBinding.findMany({
          where: { state: { is: { status: 'ACTIVE' } } },
          include: { workerHealth: true },
          orderBy: { digest: 'asc' },
        }),
      ]);
      data = { pending, retry, deadLetter, controlPending, bindings };
    } catch {
      throw new ServiceUnavailableException('Worker database is unavailable');
    }
    const issues: string[] = [];
    const fresh = (at: Date | null | undefined) => Boolean(at &&
      at.getTime() <= now.getTime() + 5_000 && now.getTime() - at.getTime() <= maxAge);
    if (!runtime.enabled || !runtime.running) issues.push('WORKER_NOT_RUNNING');
    if (!fresh(runtime.lastCompletedAt)) issues.push('WORKER_HEARTBEAT_STALE');
    if (runtime.lastError) issues.push('WORKER_STEP_FAILED');
    if (!runtime.fabricEnabled && (data.pending + data.retry + data.controlPending > 0 || data.bindings.length > 0))
      issues.push('LEDGER_PROCESSING_DISABLED');
    if (runtime.fabricEnabled) {
      const steps = ['ledger-control', 'binding-delivery'];
      if (steps.some(step => !fresh(runtime.lastSuccessfulSteps[step]))) issues.push('LEDGER_HEARTBEAT_STALE');
    }
    const bindings = data.bindings.map(binding => {
      const health = binding.workerHealth;
      const healthy = Boolean(health && fresh(health.lastCheckedAt) && fresh(health.lastHealthyAt) &&
        !health.lastErrorCode && health.certificateExpiresAt && health.certificateExpiresAt > now);
      return { bindingDigest: binding.digest, healthy,
        lastCheckedAt: health?.lastCheckedAt ?? null,
        lastHealthyAt: health?.lastHealthyAt ?? null,
        lastErrorCode: health ? health.lastErrorCode : 'NOT_OBSERVED',
        certificateExpiresAt: health?.certificateExpiresAt ?? null };
    });
    if (bindings.some(binding => !binding.healthy)) issues.push('BINDING_NOT_READY');
    const result = {
      status: issues.length ? 'degraded' : 'ok', service: 'agri-trace-blockchain-worker',
      runtime, backlog: { pending: data.pending, retry: data.retry,
        deadLetter: data.deadLetter, controlPending: data.controlPending },
      bindings, issues, timestamp: now.toISOString(),
    };
    if (issues.length) throw new ServiceUnavailableException(result);
    return result;
  }

  private positiveNumber(name: string, fallback: number) {
    const value = Number(this.config?.get<string | number>(name, fallback) ?? fallback);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }
}
