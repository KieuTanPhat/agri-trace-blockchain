import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { RegistryOperator } from '@agri-trace/fabric-gateway';
import { describe, expect, it, vi } from 'vitest';
import type { Prisma, LedgerPermissionState } from '../../generated/prisma/client.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { BindingConnectionPool } from './binding-pool.js';
import { LedgerControlService } from './ledger-control.service.js';

type Job = Prisma.LedgerControlJobGetPayload<{ include: { binding: true } }>;
function fixture(operation: Job['operation'] = 'PERMISSION_GRANT') {
  const job = { id: randomUUID(), leaseToken: randomUUID(), operation, epoch: 1,
    permissionRef: randomUUID(), bindingDigest: 'a'.repeat(64), nonce: randomUUID(), attemptCount: 1,
    expectedRevision: 0, binding: { writerMspId: 'Org1MSP' } } as Job;
  let sync = { permissionRef: job.permissionRef!, requestedEpoch: 1, confirmedEpoch: null,
    state: 'PENDING_LEDGER' as LedgerPermissionState, version: 1, barrierOrdinal: 0n,
    nextOrdinal: 1n, lastTxId: null, updatedAt: new Date() };
  const query = vi.fn().mockResolvedValue([{ id: job.id }]);
  const syncUpdate = vi.fn().mockImplementation(({ where, data }: {
    where: Record<string, unknown>; data: Record<string, unknown>;
  }) => {
    if (where.state !== sync.state || where.version !== sync.version || where.requestedEpoch !== sync.requestedEpoch)
      return { count: 0 };
    sync = { ...sync, ...data, version: sync.version + 1 } as typeof sync;
    return { count: 1 };
  });
  const findSync = vi.fn().mockImplementation(() => ({ ...sync }));
  const jobUpdate = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { $queryRaw: query, ledgerPermissionSync: { updateMany: syncUpdate, findUniqueOrThrow: findSync },
    ledgerControlJob: { updateMany: jobUpdate } };
  const prisma = { ...tx, $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn((work: (db: typeof tx) => unknown) => work(tx)),
    ledgerPermissionEpoch: { findUniqueOrThrow: vi.fn().mockResolvedValue({ entityTypes: ['SHIPMENT'] }) } };
  const pool = { configured: vi.fn().mockReturnValue(false), invalidate: vi.fn(), get: vi.fn() };
  const service = new LedgerControlService(prisma as unknown as PrismaService,
    { get: (_name: string, fallback: unknown) => fallback } as ConfigService,
    pool as unknown as BindingConnectionPool);
  return { job, service, prisma, pool, query, jobUpdate, syncUpdate,
    current: () => sync, change: (next: Partial<typeof sync>) => { sync = { ...sync, ...next }; } };
}

describe('Ledger control ownership and permission compare-and-set', () => {
  it('does not run or revive an already expired/reclaimed lease', async () => {
    const f = fixture();
    f.prisma.$executeRaw.mockResolvedValue(0);
    await f.service['run'](f.job);
    expect(f.pool.get).not.toHaveBeenCalled();
    expect(f.jobUpdate).not.toHaveBeenCalled();
    const template = f.prisma.$executeRaw.mock.calls[0]![0] as unknown as TemplateStringsArray;
    expect(template.join('')).toContain('lease_expires_at > clock_timestamp()');
  });
  it('never completes, defers or records a failure after lease ownership is lost', async () => {
    const f = fixture();
    f.query.mockResolvedValue([]);
    await f.service['writeOwned'](f.job, { status: 'COMPLETED' });
    await f.service['defer'](f.job, 1, 'drain blocked', true);
    await f.service['failure'](f.job, new Error('network unavailable'));
    expect(f.jobUpdate).not.toHaveBeenCalled();
    expect(f.pool.invalidate).not.toHaveBeenCalled();
  });
  it('terminal updates retain the exact token predicate and an owned DB row lock', async () => {
    const f = fixture();
    await f.service['writeOwned'](f.job, { status: 'COMPLETED' });
    expect(f.jobUpdate).toHaveBeenCalledWith({ where: {
      id: f.job.id, status: 'PROCESSING', leaseToken: f.job.leaseToken,
    }, data: { status: 'COMPLETED' } });
    expect((f.query.mock.calls[0]![0] as unknown as TemplateStringsArray).join('')).toContain('FOR UPDATE');
  });
  it.each(['REVOKE_REQUESTED', 'EMERGENCY_HOLD'] as const)('a lost-response grant cannot overwrite %s', async (state) => {
    const f = fixture();
    const operator = { apply: vi.fn().mockImplementation(() => {
      f.change({ state, version: 2, barrierOrdinal: 0n });
      return { proposalId: 'p', executedTxId: 'b'.repeat(64) };
    }) } as unknown as RegistryOperator;
    await f.service['execute'](f.job, operator, { getDeliveryFence: vi.fn() });
    expect(f.current().state).toBe(state);
    expect(f.current().confirmedEpoch).toBeNull();
    expect(f.syncUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: {
      permissionRef: f.job.permissionRef, requestedEpoch: 1, state: 'PENDING_LEDGER', version: 1,
    } }));
  });
  it('an old normal revoke cannot overwrite a newer emergency hold or regrant epoch', async () => {
    const f = fixture('PERMISSION_REVOKE');
    f.change({ state: 'PENDING_REVOKE_LEDGER' });
    const operator = { apply: vi.fn().mockImplementation(() => {
      f.change({ state: 'REQUESTED', requestedEpoch: 2, version: 5 });
      return { proposalId: 'p', executedTxId: 'c'.repeat(64) };
    }) } as unknown as RegistryOperator;
    f.prisma.$queryRaw.mockResolvedValue([{ n: 0n }] as never);
    await f.service['execute'](f.job, operator, { getDeliveryFence: vi.fn() });
    expect(f.current()).toMatchObject({ state: 'REQUESTED', requestedEpoch: 2, version: 5 });
  });
  it('a current lease and exact epoch/state/version can activate the confirmed grant', async () => {
    const f = fixture();
    const operator = { apply: vi.fn().mockResolvedValue({ proposalId: 'p', executedTxId: 'd'.repeat(64) }) } as unknown as RegistryOperator;
    await f.service['execute'](f.job, operator, { getDeliveryFence: vi.fn() });
    expect(f.current()).toMatchObject({ state: 'ACTIVE', confirmedEpoch: 1, version: 2 });
  });
});
