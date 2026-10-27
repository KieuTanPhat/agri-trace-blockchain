import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';

/** Phiếu nhập nguyên liệu sinh tự động khi một cơ sở chế biến/đóng gói xác
 * nhận thực nhận từ phiếu giao nhận. Tồn vẫn nằm trên tồn cơ sở của lô; phiếu
 * chỉ là chứng từ nên không giữ lượng riêng. */
export async function recordHandoverReceipt(
  tx: Prisma.TransactionClient,
  input: { transferId: string; lotId: string; organizationId: string; siteId: string; senderId: string; received: Prisma.Decimal; userId: string },
) {
  if (!input.received.gt(0)) return;
  const site = await tx.enterpriseSite.findUnique({ where: { id: input.siteId }, select: { kind: true } });
  if (!site || !['PROCESSING', 'PACKING'].includes(site.kind)) return;
  const lot = await tx.lot.findUniqueOrThrow({
    where: { id: input.lotId },
    select: { unit: true, expiryDate: true, lotCode: true, product: { select: { productName: true } } },
  });
  const sender = await tx.organization.findUnique({ where: { id: input.senderId }, select: { name: true } });
  const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).replaceAll('-', '');
  await tx.materialReceipt.create({
    data: {
      code: `PN-${day}-${randomBytes(4).toString('hex').toUpperCase()}`,
      organizationId: input.organizationId,
      siteId: input.siteId,
      source: 'AGRITRACE',
      transferId: input.transferId,
      lotId: input.lotId,
      materialName: lot.product.productName,
      supplierName: sender?.name ?? '—',
      documentNo: lot.lotCode,
      receivedAt: new Date(),
      quantity: input.received,
      unit: lot.unit,
      expiryDate: lot.expiryDate,
      createdBy: input.userId,
    },
  });
}
