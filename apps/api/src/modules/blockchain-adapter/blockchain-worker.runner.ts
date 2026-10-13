import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BlockchainWorkerService } from './blockchain-worker.service.js';
import { BindingDeliveryService } from '../ledger/binding-delivery.service.js';
import { LedgerControlService } from '../ledger/ledger-control.service.js';

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
    @Optional() private readonly bindings?: BindingDeliveryService,
    @Optional() private readonly control?: LedgerControlService,
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
      // Release A writer, release B binding delivery and the ledger control
      // plane are independent: one failing never stalls the others.
      const steps: Array<[string, () => Promise<unknown>]> = [];
      if (this.config.get<string>('FABRIC_LEGACY_WRITER') !== 'false')
        steps.push(['legacy-writer', () => this.worker.processPending()]);
      if (this.control)
        steps.push(['ledger-control', () => this.control!.processAll()]);
      if (this.bindings)
        steps.push(['binding-delivery', () => this.bindings!.processAll()]);
      const errors: string[] = [];
      for (const [name, step] of steps) {
        try {
          await step();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown worker loop error';
          errors.push(`${name}: ${message}`);
          this.logger.error(`Worker step ${name} failed: ${message}`);
        }
      }
      this.state.lastCompletedAt = new Date();
      this.state.lastError = errors.length ? errors.join('; ') : null;
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
      const signal = this.abortController.signal;
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      timer.unref();
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}
