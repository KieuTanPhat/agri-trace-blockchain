import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';

/** Capabilities that may sell goods under their own brand. */
const BRAND_SELLERS = ['RETAILER', 'DISTRIBUTOR'] as const;

/**
 * A retailer or distributor brands goods another business made. Every source
 * must be an active product of another business that this organization has
 * actually received (it holds or held a lot of it), so a label always points
 * to goods that reached the seller through a recorded handover.
 */
export async function isSeller(tx: Prisma.TransactionClient, organizationId: string) {
  return !!(await tx.organizationCapability.findFirst({ where: { organizationId, code: { in: [...BRAND_SELLERS] }, revokedAt: null } }));
}

export async function assertLabelSources(tx: Prisma.TransactionClient, organizationId: string, sourceIds: string[]) {
  if (!(await isSeller(tx, organizationId)))
    throw new ForbiddenException('Chỉ doanh nghiệp bán lẻ hoặc phân phối tạo sản phẩm nhãn riêng');
  const sources = await tx.product.findMany({ where: { id: { in: sourceIds }, status: 'ACTIVE', privateLabel: false, organizationId: { not: organizationId } } });
  if (sources.length !== sourceIds.length)
    throw new UnprocessableEntityException('Sản phẩm nguồn phải là sản phẩm đang hoạt động của doanh nghiệp khác');
  const held = await tx.lotHolding.findMany({ where: { organizationId }, select: { lotId: true } });
  const received = await tx.lot.findMany({ where: { id: { in: held.map((h) => h.lotId) }, productId: { in: sourceIds } }, select: { productId: true } });
  const seen = new Set(received.map((l) => l.productId));
  if (sourceIds.some((id) => !seen.has(id)))
    throw new UnprocessableEntityException('Chỉ chọn sản phẩm nguồn từ hàng doanh nghiệp đã nhận');
}

/** Lots packed into a private label must be of one of its sources. */
export async function assertPackable(tx: Prisma.TransactionClient, productId: string, lotIds: string[]) {
  const allowed = new Set((await tx.productLabelSource.findMany({ where: { productId }, select: { sourceProductId: true } })).map((s) => s.sourceProductId));
  const lots = await tx.lot.findMany({ where: { id: { in: lotIds } }, select: { lotCode: true, productId: true } });
  const wrong = lots.find((l) => !l.productId || !allowed.has(l.productId));
  if (wrong) throw new UnprocessableEntityException(`Lô ${wrong.lotCode} không thuộc sản phẩm nguồn của nhãn riêng`);
}

/**
 * The AgriTrace lot a supplier lot code points to: same code, and the lot left
 * AgriTrace through an external dispatch, so goods that went outside and came
 * back keep their origin. No match means the origin stops at the supplier.
 */
export async function matchSupplierLot(tx: Prisma.TransactionClient, code: string | undefined) {
  if (!code?.trim()) return null;
  const lot = await tx.lot.findFirst({ where: { lotCode: { equals: code.trim(), mode: 'insensitive' } }, select: { id: true } });
  if (!lot) return null;
  const left = await tx.traceEvent.findFirst({ where: { lotId: lot.id, eventType: 'DISTRIBUTION_QUANTITY_RECORDED', businessData: { path: ['kind'], equals: 'EXTERNAL_DISPATCH' } }, select: { id: true } });
  return left ? lot.id : null;
}
