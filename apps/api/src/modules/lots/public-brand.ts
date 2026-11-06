import type { PrismaService } from '../../prisma/prisma.service.js';
import { RECEIPT_EVIDENCE_KINDS, trustLevel } from '../processing/supplier-confirmations.js';

type PublicLot = {
  productId: string;
  processingRunId: string | null;
  harvest?: { cycle: { chainId: string | null } } | null;
  processingRun?: { chainId: string } | null;
};

/** ADR-005: the chain owner's brand shows only for a product the platform
 * approved and that the chain owner owns; a processed lot also reports how
 * its material sources were recorded. Nothing private leaves the server. */
export async function publicBrandAndTrust(db: PrismaService, lot: PublicLot) {
  const chainId = lot.harvest?.cycle.chainId ?? lot.processingRun?.chainId ?? null;
  const [chain, product] = await Promise.all([
    chainId
      ? db.supplyChain.findUnique({ where: { id: chainId }, select: { ownerOrganizationId: true, personal: true } })
      : null,
    db.product.findUnique({
      where: { id: lot.productId },
      select: { productName: true, description: true, organizationId: true, approvalStatus: true, privateLabel: true },
    }),
  ]);
  let brand = null;
  // A private label carries its seller's brand in any chain it was packed in.
  const brandOwner = product?.privateLabel ? product.organizationId : chain?.ownerOrganizationId;
  if (
    chain &&
    !chain.personal &&
    brandOwner &&
    product?.approvalStatus === 'APPROVED' &&
    product.organizationId === brandOwner
  ) {
    const owner = await db.organization.findUnique({ where: { id: brandOwner }, select: { name: true } });
    if (owner) brand = { organizationName: owner.name, productName: product.productName, story: product.description ?? null };
  }
  let sourceTrust = null;
  if (lot.processingRunId) {
    const [inputs, external] = await Promise.all([
      db.processingInput.count({ where: { runId: lot.processingRunId } }),
      db.processingExternalInput.findMany({ where: { runId: lot.processingRunId }, select: { receiptId: true } }),
    ]);
    const ids = external.map((e) => e.receiptId);
    const [evidence, confirmed] = await Promise.all([
      db.traceEvidence.findMany({
        where: { entityType: 'MATERIAL_RECEIPT', entityId: { in: ids }, kind: { in: [...RECEIPT_EVIDENCE_KINDS] }, withdrawal: { is: null } },
        select: { entityId: true },
      }),
      db.supplierConfirmation.findMany({ where: { receiptId: { in: ids }, status: 'CONFIRMED' }, select: { receiptId: true } }),
    ]);
    const levels = ids.map((id) =>
      trustLevel({
        source: 'EXTERNAL',
        hasEvidence: evidence.some((e) => e.entityId === id),
        confirmed: confirmed.some((c) => c.receiptId === id),
      }),
    );
    sourceTrust = {
      selfRecorded: inputs,
      supplierConfirmed: levels.filter((l) => l === 'SUPPLIER_CONFIRMED').length,
      evidenced: levels.filter((l) => l === 'EVIDENCED').length,
      declared: levels.filter((l) => l === 'DECLARED').length,
    };
  }
  return { brand, sourceTrust };
}
