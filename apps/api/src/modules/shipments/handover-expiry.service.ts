import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { lockAggregate } from '../../common/idempotency/command-transaction.js';

/** Bounded background reconciliation. It changes only an overdue offer's
 * terminal state; quantities, custody, signed intent and trace stay intact. */
@Injectable()
export class HandoverExpiryService {
  constructor(private readonly prisma: PrismaService) {}

  async expireDue(shipmentId?: string, batchSize = 100): Promise<number> {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1000)
      throw new Error('Invalid handover expiry batch size');
    const due = await this.prisma.shipmentHandover.findMany({
      where: {
        state: 'OFFERED',
        expiresAt: { lte: new Date() },
        ...(shipmentId ? { shipmentId } : {}),
      },
      select: { id: true, shipment: { select: { lotId: true } } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: batchSize,
    });
    let expired = 0;
    for (const candidate of due) {
      expired += await this.prisma.$transaction(async (tx) => {
        // Same lot -> handover lock order as confirmation/reject/cancel and
        // quantity/custody commands. Re-read after acquiring both locks.
        await lockAggregate(tx, 'lot', candidate.shipment.lotId);
        await tx.$queryRaw(Prisma.sql`SELECT handover_id FROM shipment_handover
          WHERE handover_id = ${candidate.id}::uuid FOR UPDATE`);
        const row = await tx.shipmentHandover.findUnique({ where: { id: candidate.id } });
        const now = new Date();
        if (!row || row.state !== 'OFFERED' || row.expiresAt > now) return 0;
        const changed = await tx.shipmentHandover.updateMany({
          where: { id: row.id, version: row.version, state: 'OFFERED', expiresAt: { lte: now } },
          data: {
            state: 'EXPIRED',
            resolvedAt: now,
            reason: 'Hết hạn chờ xác nhận',
            version: { increment: 1 },
          },
        });
        return changed.count;
      });
    }
    return expired;
  }
}
