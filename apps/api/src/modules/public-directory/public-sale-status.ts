import type { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { vietnamCalendarDate } from '../../common/expiry-date.js';
import { publicLotWhere } from './public-directory.policy.js';
export function hasSaleableStock(stock: {
  quantity: Prisma.Decimal;
  reserved: Prisma.Decimal;
  quarantined?: Prisma.Decimal;
}) {
  return stock.quantity
    .sub(stock.reserved)
    .sub(stock.quarantined ?? 0)
    .gt(0);
}
/** Binary market availability. A proposed/in-transit transfer is never a sale. */
export async function sellingLots(db: PrismaService, productIds: string[]) {
  if (!productIds.length) return new Set<string>();
  const today = new Date(`${vietnamCalendarDate(new Date())}T00:00:00.000Z`);
  const lots = await db.lot.findMany({
    where: publicLotWhere({
      productId: { in: productIds },
      currentState: {
        notIn: [
          'RECALLED',
          'EXPIRED',
          'DAMAGED',
          'REJECTED',
          'CONSUMED',
          'SOLD',
        ],
      },
      OR: [{ expiryDate: null }, { expiryDate: { gte: today } }],
    }),
    select: {
      id: true,
      currentState: true,
      availableQuantity: true,
      shipment: { select: { retailerOrgId: true, status: true } },
    },
  });
  const ids = lots.map((l) => l.id);
  if (!ids.length) return new Set<string>();
  const [holdings, sites, retailers, notices] = await Promise.all([
    db.lotHolding.findMany({ where: { lotId: { in: ids } } }),
    db.lotSiteHolding.findMany({ where: { lotId: { in: ids } } }),
    db.organization.findMany({
      where: { type: 'RETAILER', status: 'ACTIVE' },
      select: { id: true },
    }),
    db.traceNotice.findMany({
      where: { lotId: { in: ids }, kind: 'RECALL' },
      select: { lotId: true },
    }),
  ]);
  const active = new Set(retailers.map((o) => o.id)),
    recalled = new Set(notices.map((n) => n.lotId));
  return new Set(
    lots
      .filter((l) => {
        if (recalled.has(l.id)) return false;
        const all = holdings.filter((h) => h.lotId === l.id);
        // Distribution holdings are authoritative once initialized; never revive a
        // depleted holding using the legacy global availableQuantity.
        if (all.length)
          return all.some((h) => {
            if (!active.has(h.organizationId) || !hasSaleableStock(h))
              return false;
            const allocated = sites.filter(
              (s) => s.lotId === l.id && s.organizationId === h.organizationId,
            );
            return allocated.length
              ? allocated.some(hasSaleableStock)
              : hasSaleableStock(h);
          });
        return (
          l.currentState === 'FOR_SALE' &&
          l.availableQuantity.gt(0) &&
          !!l.shipment &&
          active.has(l.shipment.retailerOrgId) &&
          l.shipment.status === 'DELIVERED'
        );
      })
      .map((l) => l.id),
  );
}
