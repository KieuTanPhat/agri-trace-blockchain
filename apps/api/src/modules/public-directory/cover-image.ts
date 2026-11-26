import type { PrismaService } from '../../prisma/prisma.service.js';
import { visibleDirectoryImage } from './public-directory.presentation.js';

type Db = Pick<PrismaService, 'traceEvidence' | 'productPhotoOrder' | 'product' | 'lot' | 'processingInput' | 'traceQrBlock'>;
const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const SOURCE_DEPTH = 3;

/** Main photo of each active product: the first of the owner's photo order,
 * else the newest current product photo. A product photo shows the goods
 * themselves, so it may stand in for a lot that has none of its own. */
export async function productCoverImages(db: Db, productIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const active = await db.product.findMany({ where: { id: { in: productIds }, status: 'ACTIVE' }, select: { id: true } });
  const ids = active.map((p) => p.id);
  if (!ids.length) return result;
  const [rows, orders] = await Promise.all([
    db.traceEvidence.findMany({
      where: { entityType: 'PRODUCT', entityId: { in: ids }, kind: 'PRODUCT_IMAGE', mediaType: { in: IMAGE_TYPES }, withdrawal: { is: null } },
      select: { id: true, entityId: true, supersedesId: true },
      orderBy: { createdAt: 'desc' },
    }),
    db.productPhotoOrder.findMany({ where: { productId: { in: ids } }, select: { productId: true, evidenceIds: true } }),
  ]);
  const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
  for (const id of ids) {
    const current = rows.filter((r) => r.entityId === id && !superseded.has(r.id));
    if (!current.length) continue;
    const order = orders.find((o) => o.productId === id)?.evidenceIds ?? [];
    result.set(id, order.find((e) => current.some((r) => r.id === e)) ?? current[0].id);
  }
  return result;
}

export async function productCoverImage(db: Db, productId: string): Promise<{ id: string } | null> {
  const id = (await productCoverImages(db, [productId])).get(productId);
  return id ? { id } : null;
}

/** Public photo of the material lots a processed or packed lot was made from,
 * nearest first; lots with a blocked QR page never lend their photo. */
async function sourceLotImage(db: Db, lotId: string): Promise<{ id: string } | null> {
  const seen = new Set([lotId]);
  let frontier = [lotId];
  for (let depth = 0; depth < SOURCE_DEPTH && frontier.length; depth++) {
    const lots = await db.lot.findMany({ where: { id: { in: frontier } }, select: { processingRunId: true } });
    const runs = lots.map((l) => l.processingRunId).filter((r): r is string => !!r);
    if (!runs.length) return null;
    const inputs = await db.processingInput.findMany({ where: { runId: { in: runs } }, select: { lotId: true }, orderBy: { createdAt: 'asc' } });
    const blocked = new Set(
      (await db.traceQrBlock.findMany({ where: { lotId: { in: inputs.map((i) => i.lotId) }, unblockedAt: null }, select: { lotId: true } })).map((b) => b.lotId),
    );
    frontier = [...new Set(inputs.map((i) => i.lotId))].filter((id) => !seen.has(id) && !blocked.has(id));
    frontier.forEach((id) => seen.add(id));
    for (const id of frontier) {
      const image = await lotOwnImage(db, id);
      if (image) return image;
    }
  }
  return null;
}

async function lotOwnImage(db: Db, lotId: string) {
  const rows = await db.traceEvidence.findMany({
    where: { entityType: 'LOT', entityId: lotId },
    select: { id: true, public: true, kind: true, mediaType: true, supersedesId: true, withdrawal: { select: { evidenceId: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return visibleDirectoryImage(rows);
}

/** Cover photo of a lot's public page: its own lot photo, else the product
 * photo, else a photo of the material lots it came from. */
export async function lotCoverImage(db: Db, lot: { id: string; productId: string }): Promise<{ id: string } | null> {
  return (await lotOwnImage(db, lot.id)) ?? (await productCoverImage(db, lot.productId)) ?? (await sourceLotImage(db, lot.id));
}
