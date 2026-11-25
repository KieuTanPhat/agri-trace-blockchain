import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  appendPlatformAudit,
  lockPlatformAudit,
} from '../platform-governance/platform-audit.js';

@Injectable()
export class SubscriptionTermWorker {
  constructor(private readonly db: PrismaService) {}
  async processAll(now = new Date()) {
    const terms = await this.db.subscriptionTerm.findMany({
      where: { status: 'SCHEDULED', startsAt: { lte: now } },
      orderBy: { startsAt: 'asc' },
      take: 100,
    });
    let activated = 0;
    for (const candidate of terms) {
      activated += await this.db.$transaction(async (tx) => {
        await lockPlatformAudit(tx);
        const sub = await tx.subscription.findUniqueOrThrow({
          where: { id: candidate.subscriptionId },
        });
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${sub.organizationId}`},0))`;
        await tx.$queryRaw`SELECT id FROM subscription WHERE id = ${sub.id}::uuid FOR UPDATE`;
        const current = await tx.subscription.findUniqueOrThrow({
          where: { id: sub.id },
        });
        const term = await tx.subscriptionTerm.findUniqueOrThrow({
          where: { id: candidate.id },
        });
        if (
          term.status !== 'SCHEDULED' ||
          !term.startsAt ||
          !term.endsAt ||
          term.startsAt > now
        )
          return 0;
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: term.invoiceId },
        });
        if (current.status !== 'ACTIVE' || invoice.status !== 'PAID')
          throw new Error(
            'Scheduled renewal requires an active subscription and paid invoice',
          );
        if (current.endsAt && current.endsAt > term.startsAt)
          throw new Error('Scheduled renewal overlaps the current term');
        await tx.subscription.update({
          where: { id: current.id },
          data: {
            planVersionId: term.planVersionId,
            startsAt: term.startsAt,
            endsAt: term.endsAt,
            version: { increment: 1 },
          },
        });
        await tx.subscriptionTerm.update({
          where: { id: term.id },
          data: { status: 'ACTIVE', activatedAt: now },
        });
        await appendPlatformAudit(tx, {
          actor: null,
          action: 'SUBSCRIPTION_TERM_ACTIVATED',
          subjectType: 'SUBSCRIPTION',
          subjectId: current.id,
          organizationId: current.organizationId,
          details: {
            invoiceId: invoice.id,
            termId: term.id,
            planVersionId: term.planVersionId,
          },
        });
        return 1;
      });
    }
    return { activated };
  }
}
