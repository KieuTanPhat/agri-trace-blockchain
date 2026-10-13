import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BindingConnection, BindingConnectionPool } from './binding-pool.js';
import { BindingDeliveryService } from './binding-delivery.service.js';

function fixture() {
  const eventId = randomUUID();
  const job = { id: randomUUID(), eventId, leaseToken: randomUUID(), attemptCount: 1,
    traceEvent: { id: eventId, eventTime: new Date(), dataHash: 'a'.repeat(64),
      bindingContext: { commitmentVersion: 'b1', permissions: [], bindingDigest: 'b'.repeat(64) } },
  } as unknown as Parameters<BindingDeliveryService['deliver']>[0];
  const binding = { digest: 'b'.repeat(64), chainRef: randomUUID() } as Parameters<BindingDeliveryService['deliver']>[1];
  let owned = true;
  const query = vi.fn().mockImplementation(async () => owned ? [{ id: job.id }] : []);
  const update = vi.fn().mockResolvedValue({ count: 1 });
  const outcomes = { aggregate: vi.fn().mockResolvedValue({ _max: { sequence: 1 } }), create: vi.fn().mockResolvedValue({}) };
  const tx = { $queryRaw: query, blockchainOutbox: { updateMany: update },
    blockchainProof: { upsert: vi.fn() },
    deliveryAttempt: { create: vi.fn().mockResolvedValue({ id: randomUUID() }) },
    deliveryAttemptOutcome: outcomes,
  };
  const prisma = { ...tx, $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((fn: (db: typeof tx) => unknown) => fn(tx)) };
  const service = new BindingDeliveryService(prisma as unknown as PrismaService,
    { get: (_key: string, fallback: unknown) => fallback } as ConfigService,
    {} as BindingConnectionPool);
  const submit = vi.fn();
  const endorse = vi.fn().mockResolvedValue({ submit });
  const client = { getDeliveryFence: vi.fn().mockResolvedValue({ generation: '0' }),
    recordBindingEvent: vi.fn().mockReturnValue({ transactionId: 'c'.repeat(64), endorse }) };
  const connection = { client, fingerprint: 'd'.repeat(64) } as unknown as BindingConnection;
  return { service, job, binding, connection, prisma, tx, query, outcomes, endorse, submit,
    reclaim: () => { owned = false; } };
}

describe('Binding delivery ownership across worker replacement', () => {
  it('does not revive an expired claim from an earlier batch', async () => {
    const f = fixture();
    f.prisma.$executeRaw.mockResolvedValue(0);
    await f.service['deliver'](f.job, f.binding, f.connection);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
    expect((f.prisma.$executeRaw.mock.calls[0]![0] as unknown as TemplateStringsArray).join(''))
      .toContain('lease_expires_at > clock_timestamp()');
  });

  it('cannot create an attempt after the outbox lease was reclaimed', async () => {
    const f = fixture();
    f.reclaim();
    await expect(f.service['attempt'](f.job, f.binding, f.connection)).rejects.toThrow();
    expect(f.tx.deliveryAttempt.create).not.toHaveBeenCalled();
    expect(f.endorse).not.toHaveBeenCalled();
  });

  it('does not broadcast or append outcomes when ownership is lost during endorsement', async () => {
    const f = fixture();
    f.endorse.mockImplementation(async () => { f.reclaim(); return { submit: f.submit }; });
    await expect(f.service['attempt'](f.job, f.binding, f.connection)).rejects.toThrow();
    expect(f.tx.deliveryAttempt.create).toHaveBeenCalledOnce();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.outcomes.create).not.toHaveBeenCalled();
  });

  it('records SUBMITTED before broadcasting and lets the new owner reconcile a late result', async () => {
    const f = fixture();
    f.submit.mockImplementation(async () => {
      expect(f.outcomes.create.mock.calls.map(([arg]) => arg.data.state)).toEqual(['ENDORSED', 'SUBMITTED']);
      f.reclaim();
      return { successful: true, blockNumber: 1n };
    });
    await expect(f.service['attempt'](f.job, f.binding, f.connection)).rejects.toThrow();
    expect(f.outcomes.create.mock.calls.map(([arg]) => arg.data.state)).toEqual(['ENDORSED', 'SUBMITTED']);
    expect(f.tx.blockchainProof.upsert).not.toHaveBeenCalled();
  });

  it('fences terminal, defer, failure and outcome writes from the stale worker', async () => {
    const f = fixture();
    f.reclaim();
    await f.service['release'](f.job, 1000, 'outage');
    await f.service['fail'](f.job, new Error('late failure'));
    await expect(f.service['outcome'](f.job, randomUUID(), 'VALID')).rejects.toThrow();
    const proof = { recordedAt: new Date().toISOString() } as Parameters<BindingDeliveryService['complete']>[2];
    await expect(f.service['complete'](f.job, f.binding, proof, null)).rejects.toThrow();
    expect(f.tx.blockchainOutbox.updateMany).not.toHaveBeenCalled();
    expect(f.tx.blockchainProof.upsert).not.toHaveBeenCalled();
    expect(f.outcomes.create).not.toHaveBeenCalled();
  });
});
