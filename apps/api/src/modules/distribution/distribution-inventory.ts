import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';

export async function activeSite(tx: Prisma.TransactionClient, organizationId: string, siteId: string) {
  const site = await tx.enterpriseSite.findFirst({ where: { id: siteId, organizationId, status: 'ACTIVE' } });
  if (!site) throw new ForbiddenException('Cơ sở ngoài tổ chức hoặc đã ngừng sử dụng');
  return site;
}

export async function siteBalance(tx: Prisma.TransactionClient, lotId: string, organizationId: string, siteId: string) {
  return tx.lotSiteHolding.findUnique({ where: { lotId_organizationId_siteId: { lotId, organizationId, siteId } } });
}

export async function requireSiteStock(tx: Prisma.TransactionClient, lotId: string, organizationId: string, siteId: string, amount: Prisma.Decimal) {
  await activeSite(tx, organizationId, siteId);
  const stock = await siteBalance(tx, lotId, organizationId, siteId);
  if (!stock || stock.quantity.sub(stock.reserved).sub(stock.quarantined).lt(amount))
    throw new ConflictException('Cơ sở không đủ lượng khả dụng; phân bổ tồn trước khi giao hoặc ghi giảm');
  return stock;
}

export async function addSiteStock(tx: Prisma.TransactionClient, lotId: string, organizationId: string, siteId: string, amount: Prisma.Decimal, quarantine = new Prisma.Decimal(0)) {
  return tx.lotSiteHolding.upsert({
    where: { lotId_organizationId_siteId: { lotId, organizationId, siteId } },
    create: { lotId, organizationId, siteId, quantity: amount, quarantined: quarantine },
    update: { quantity: { increment: amount }, quarantined: { increment: quarantine }, version: { increment: 1 } },
  });
}

/** Internal site-to-site quantity that left a source site and is not yet at a site. */
export async function internalInTransit(tx: Prisma.TransactionClient, lotId: string, organizationId: string) {
  const rows = await tx.siteTransfer.findMany({ where: { lotId, organizationId, status: { in: ['IN_TRANSIT', 'DISCREPANCY'] } }, select: { status: true, quantity: true, receivedQuantity: true } });
  return rows.reduce((sum, r) => sum.add(r.status === 'IN_TRANSIT' ? r.quantity : r.quantity.sub(r.receivedQuantity ?? 0)), new Prisma.Decimal(0));
}

/** Quarantined stock at a site that no open quarantine slip accounts for (e.g. from a delivery receipt). */
export async function unslippedQuarantine(tx: Prisma.TransactionClient, lotId: string, organizationId: string, siteId: string, quarantined: Prisma.Decimal) {
  const open = await tx.quarantineCase.findMany({ where: { lotId, organizationId, siteId, status: 'ACTIVE' }, select: { quantity: true, releasedQuantity: true, disposedQuantity: true } });
  return open.reduce((rest, c) => rest.sub(c.quantity.sub(c.releasedQuantity).sub(c.disposedQuantity)), quarantined);
}

/** Consumes part of an open quarantine slip by release or disposal. */
export async function consumeQuarantineCase(tx: Prisma.TransactionClient, caseId: string, scope: { lotId: string; organizationId: string; siteId: string }, amount: Prisma.Decimal, by: 'RELEASE' | 'DISPOSE') {
  await tx.$queryRaw`SELECT id FROM quarantine_case WHERE id=${caseId}::uuid FOR UPDATE`;
  const slip = await tx.quarantineCase.findUnique({ where: { id: caseId } });
  if (!slip || slip.lotId !== scope.lotId || slip.organizationId !== scope.organizationId || slip.siteId !== scope.siteId)
    throw new ConflictException('Phiếu cách ly không thuộc lô và cơ sở này');
  if (slip.status !== 'ACTIVE') throw new ConflictException('Phiếu cách ly đã đóng');
  const open = slip.quantity.sub(slip.releasedQuantity).sub(slip.disposedQuantity);
  if (open.lt(amount)) throw new ConflictException('Vượt lượng còn cách ly của phiếu');
  const released = by === 'RELEASE' ? slip.releasedQuantity.add(amount) : slip.releasedQuantity;
  const disposed = by === 'DISPOSE' ? slip.disposedQuantity.add(amount) : slip.disposedQuantity;
  const closed = released.add(disposed).eq(slip.quantity);
  return tx.quarantineCase.update({
    where: { id: caseId },
    data: { releasedQuantity: released, disposedQuantity: disposed, version: { increment: 1 }, ...(closed ? { status: disposed.gt(0) ? 'DISPOSED' : 'RELEASED', closedAt: new Date() } : {}) },
  });
}

export type ReceiptLine = { lotId: string; received: string; rejected: string; quarantined: string; missing: string };
