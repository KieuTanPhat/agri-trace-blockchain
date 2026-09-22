import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainWorkerService } from './blockchain-worker.service.js';

export type WorkerRuntimeState = {
  enabled: boolean;
  running: boolean;
  startedAt: Date | null;
  lastCompletedAt: Date | null;
  lastError: string | null;
};

@Injectable()
export class BlockchainWorkerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(BlockchainWorkerRunner.name);
  private readonly abortController = new AbortController();
  private loopPromise?: Promise<void>;
  private readonly state: WorkerRuntimeState = {
    enabled: false,
    running: false,
    startedAt: null,
    lastCompletedAt: null,
    lastError: null,
  };

  constructor(
    private readonly worker: BlockchainWorkerService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.state.enabled = this.config.get<string>('FABRIC_ENABLED') === 'true';
    this.state.startedAt = new Date();
    if (!this.state.enabled) {
      this.logger.warn('Blockchain worker is disabled by FABRIC_ENABLED');
      return;
    }
    this.state.running = true;
    this.loopPromise = this.runLoop();
  }

  async onApplicationShutdown(): Promise<void> {
    this.abortController.abort();
    await this.loopPromise;
    this.state.running = false;
  }

  getState(): WorkerRuntimeState {
    return { ...this.state };
  }

  private async runLoop(): Promise<void> {
    const interval = this.positiveNumber('FABRIC_WORKER_INTERVAL_MS', 10_000);
    while (!this.abortController.signal.aborted) {
      try {
        await this.worker.processPending();
        this.state.lastCompletedAt = new Date();
        this.state.lastError = null;
      } catch (error) {
        this.state.lastError =
          error instanceof Error ? error.message : 'Unknown worker loop error';
        this.logger.error(`Worker loop failed: ${this.state.lastError}`);
      }
      await this.wait(interval);
    }
  }

  private positiveNumber(name: string, fallback: number): number {
    const value = Number(this.config.get<string | number>(name, fallback));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
  }

  private wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      if (this.abortController.signal.aborted) return resolve();
      const timer = setTimeout(resolve, milliseconds);
      timer.unref();
      this.abortController.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }
}
