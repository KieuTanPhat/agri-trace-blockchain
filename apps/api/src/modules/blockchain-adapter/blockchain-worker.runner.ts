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
import { HandoverExpiryService } from '../shipments/handover-expiry.service.js';
import { EnterpriseConnectionWorker } from '../enterprise-onboarding/enterprise-connection.worker.js';
import { EnterpriseMailWorker } from '../enterprise-onboarding/enterprise-mail.worker.js';

export type WorkerRuntimeState = {
  enabled: boolean;
  fabricEnabled: boolean;
  running: boolean;
  startedAt: Date | null;
  lastCompletedAt: Date | null;
  lastError: string | null;
  lastSuccessfulSteps: Record<string, Date>;
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
    fabricEnabled: false,
    running: false,
    startedAt: null,
    lastCompletedAt: null,
    lastError: null,
    lastSuccessfulSteps: {},
  };

  constructor(
    private readonly worker: BlockchainWorkerService,
    private readonly config: ConfigService,
    @Optional() private readonly bindings?: BindingDeliveryService,
    @Optional() private readonly control?: LedgerControlService,
    @Optional() private readonly expiry?: HandoverExpiryService,
    @Optional() private readonly enterprise?: EnterpriseConnectionWorker,
    @Optional() private readonly mail?: EnterpriseMailWorker,
  ) {}

  onApplicationBootstrap(): void {
    this.state.fabricEnabled =
      this.config.get<string>('FABRIC_ENABLED') === 'true';
    this.state.enabled =
      this.state.fabricEnabled ||
      Boolean(this.mail?.enabled) ||
      Boolean(
        this.expiry &&
        this.config.get<string>('HANDOVER_EXPIRY_ENABLED') !== 'false',
      );
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
    return {
      ...this.state,
      lastSuccessfulSteps: { ...this.state.lastSuccessfulSteps },
    };
  }

  private async runLoop(): Promise<void> {
    const interval = this.positiveNumber('FABRIC_WORKER_INTERVAL_MS', 10_000);
    while (!this.abortController.signal.aborted) {
      // Release A writer, release B binding delivery and the ledger control
      // plane are independent: one failing never stalls the others.
      const steps: Array<[string, () => Promise<unknown>]> = [];
      const fabricEnabled = this.state.fabricEnabled;
      if (
        fabricEnabled &&
        this.config.get<string>('FABRIC_LEGACY_WRITER') !== 'false'
      )
        steps.push(['legacy-writer', () => this.worker.processPending()]);
      if (fabricEnabled && this.control)
        steps.push(['ledger-control', () => this.control!.processAll()]);
      if (fabricEnabled && this.bindings)
        steps.push(['binding-delivery', () => this.bindings!.processAll()]);
      if (fabricEnabled && this.enterprise)
        steps.push([
          'enterprise-connections',
          () => this.enterprise!.processAll(),
        ]);
      if (this.mail?.enabled)
        steps.push(['enterprise-mail', () => this.mail!.processAll()]);
      if (
        this.expiry &&
        this.config.get<string>('HANDOVER_EXPIRY_ENABLED') !== 'false'
      )
        steps.push([
          'handover-expiry',
          () =>
            this.expiry!.expireDue(
              undefined,
              this.positiveNumber('HANDOVER_EXPIRY_BATCH_SIZE', 100),
            ),
        ]);
      const errors: string[] = [];
      for (const [name, step] of steps) {
        try {
          const result = await step();
          if (
            name === 'binding-delivery' &&
            result &&
            typeof result === 'object' &&
            'failedBindings' in result &&
            Array.isArray(result.failedBindings) &&
            result.failedBindings.length
          )
            throw new Error(
              `${result.failedBindings.length} binding(s) unavailable`,
            );
          this.state.lastSuccessfulSteps[name] = new Date();
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Unknown worker loop error';
          errors.push(`${name}: ${message}`);
          this.logger.error(`Worker step ${name} failed: ${message}`);
        }
      }
      if (!errors.length) this.state.lastCompletedAt = new Date();
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
