import { vi } from 'vitest';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BlockchainWorkerService } from './blockchain-worker.service.js';

describe('BlockchainWorkerService distributed claim', () => {
  it('claims due proofs under a PostgreSQL SKIP LOCKED transaction', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback({ $queryRaw: queryRaw }),
    );
    const service = new BlockchainWorkerService({
      $transaction: transaction,
    } as unknown as PrismaService);

    await expect(service.processPending(7)).resolves.toEqual({
      processed: 0,
      skipped: false,
    });

    expect(transaction).toHaveBeenCalledOnce();
    const sql = queryRaw.mock.calls[0][0] as { strings: readonly string[] };
    expect(sql.strings.join(' ')).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql.strings.join(' ')).toContain('next_attempt_at');
    expect(sql.strings.join(' ')).toContain('previous_event_hash');
    expect(sql.strings.join(' ')).toContain(
      'previous_proof.transaction_status',
    );
  });
});
