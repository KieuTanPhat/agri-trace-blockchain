import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { BlockchainWorkerRunner, WorkerRuntimeState } from '../modules/blockchain-adapter/blockchain-worker.runner.js';
import { WorkerHealthController } from './worker-health.controller.js';

function fixture(overrides: Partial<WorkerRuntimeState> = {}) {
  const now = new Date();
  const state: WorkerRuntimeState = { enabled: true, running: true, fabricEnabled: true,
    startedAt: now, lastCompletedAt: now, lastError: null,
    lastSuccessfulSteps: { 'ledger-control': now, 'binding-delivery': now }, ...overrides };
  const db = { $queryRaw: vi.fn().mockResolvedValue([{ value: 1 }]),
    blockchainOutbox: { count: vi.fn().mockResolvedValue(0) },
    ledgerControlJob: { count: vi.fn().mockResolvedValue(0) },
    fabricNetworkBinding: { findMany: vi.fn().mockResolvedValue([]) } };
  const controller = new WorkerHealthController(db as unknown as PrismaService,
    { getState: () => state } as BlockchainWorkerRunner);
  return { controller, db, state };
}

describe('Worker readiness reports actual processing', () => {
  it('rejects stopped processing while database and liveness remain available', async () => {
    const { controller, db } = fixture({ running: false });
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.$queryRaw).toHaveBeenCalled();
    expect(controller.live().status).toBe('ok');
  });
  it('rejects a stale ledger heartbeat even when expiry work succeeded', async () => {
    const { controller } = fixture({ lastSuccessfulSteps: {
      'handover-expiry': new Date(), 'binding-delivery': new Date(0), 'ledger-control': new Date(0),
    } });
    await expect(controller.ready()).rejects.toMatchObject({ response: {
      status: 'degraded', issues: expect.arrayContaining(['LEDGER_HEARTBEAT_STALE']),
    } });
  });
  it('rejects expiry-only processing when ledger work is pending', async () => {
    const { controller, db } = fixture({ fabricEnabled: false });
    db.blockchainOutbox.count.mockResolvedValueOnce(1);
    await expect(controller.ready()).rejects.toMatchObject({ response: {
      issues: expect.arrayContaining(['LEDGER_PROCESSING_DISABLED']),
    } });
  });
  it('marks an unobserved active binding degraded without exposing connection or key paths', async () => {
    const { controller, db } = fixture();
    db.fabricNetworkBinding.findMany.mockResolvedValue([{ digest: 'a'.repeat(64), workerHealth: null }] as never);
    await expect(controller.ready()).rejects.toMatchObject({ response: {
      bindings: [{ bindingDigest: 'a'.repeat(64), healthy: false, lastCheckedAt: null,
        lastHealthyAt: null, lastErrorCode: 'NOT_OBSERVED', certificateExpiresAt: null }],
    } });
  });
  it('requires an unexpired credential and fresh successful observations per binding', async () => {
    const { controller, db } = fixture();
    const health = { lastCheckedAt: new Date(), lastHealthyAt: new Date(),
      lastErrorCode: null, certificateExpiresAt: new Date(Date.now() - 1_000) };
    db.fabricNetworkBinding.findMany.mockResolvedValue([{ digest: 'b'.repeat(64), workerHealth: health }] as never);
    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
    health.certificateExpiresAt = new Date(Date.now() + 86_400_000);
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ok', bindings: [{ healthy: true }] });
  });
});
