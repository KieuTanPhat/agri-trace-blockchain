import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsString, MaxLength, Min, MinLength } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { appendPlatformAudit, lockPlatformAudit } from '../platform-governance/platform-audit.js';
import { chainOwner } from '../enterprise-onboarding/registration-profile.dto.js';

type Tx = Prisma.TransactionClient;
const DECLARATION_KINDS = ['PRODUCT_DECLARATION', 'QUALITY_CERTIFICATE'];

export class ProductApprovalRequestInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
}
export class ProductApprovalReviewInput {
  @ApiProperty({ minimum: 0 }) @IsInt() @Min(0) version!: number;
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @ApiProperty({ minLength: 5, maxLength: 1000 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  note!: string;
}

export const productApprovalView = (p: {
  id: string;
  productName: string;
  organizationId: string | null;
  approvalStatus: string;
  approvalRequestedAt: Date | null;
  approvedAt: Date | null;
  approvalNote: string | null;
  version: number;
}) => ({
  productId: p.id,
  productName: p.productName,
  organizationId: p.organizationId,
  approvalStatus: p.approvalStatus,
  approvalRequestedAt: p.approvalRequestedAt?.toISOString() ?? null,
  approvedAt: p.approvedAt?.toISOString() ?? null,
  approvalNote: p.approvalNote,
  version: p.version,
});

/** A chain owner asks the platform to approve the product declaration that
 * gates its public brand page (ADR-005). Lot recording never waits for it. */
export async function requestProductApproval(tx: Tx, actor: CommandActor, id: string, input: ProductApprovalRequestInput) {
  const product = await tx.product.findFirst({ where: { id, organizationId: actor.organizationId! } });
  if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
  if (product.version !== input.version) throw new ConflictException('Sản phẩm đã thay đổi; tải lại');
  const org = await tx.organization.findUniqueOrThrow({ where: { id: actor.organizationId! } });
  if (!chainOwner(org.participationStatus))
    throw new ForbiddenException('Chỉ chủ chuỗi gửi duyệt trang thương hiệu sản phẩm');
  if (product.status !== 'ACTIVE') throw new ConflictException('Hoàn tất sản phẩm trước khi gửi duyệt');
  if (!['NONE', 'REJECTED'].includes(product.approvalStatus))
    throw new ConflictException('Sản phẩm đang chờ duyệt hoặc đã được duyệt');
  const declarations = await tx.traceEvidence.count({
    where: { organizationId: org.id, entityType: 'PRODUCT', entityId: id, kind: { in: DECLARATION_KINDS }, withdrawal: { is: null } },
  });
  if (!declarations)
    throw new ConflictException('Tải bản công bố sản phẩm hoặc giấy chứng nhận chất lượng trước khi gửi duyệt');
  const updated = await tx.product.update({
    where: { id },
    data: { approvalStatus: 'PENDING', approvalRequestedAt: new Date(), approvalNote: null, version: { increment: 1 } },
  });
  return productApprovalView(updated);
}

export async function reviewProductApproval(tx: Tx, actor: CommandActor, id: string, input: ProductApprovalReviewInput) {
  if (actor.role !== 'SYSTEM_ADMIN') throw new ForbiddenException();
  await lockPlatformAudit(tx);
  await tx.$queryRaw`SELECT product_id FROM product WHERE product_id=${id}::uuid FOR UPDATE`;
  const product = await tx.product.findUnique({ where: { id } });
  if (!product) throw new NotFoundException('Không tìm thấy sản phẩm');
  if (product.approvalStatus !== 'PENDING' || product.version !== input.version)
    throw new ConflictException('Yêu cầu đã được xử lý hoặc đã thay đổi');
  const approve = input.decision === 'APPROVE';
  const updated = await tx.product.update({
    where: { id },
    data: {
      approvalStatus: approve ? 'APPROVED' : 'REJECTED',
      approvedBy: approve ? actor.sub : null,
      approvedAt: approve ? new Date() : null,
      approvalNote: input.note,
      version: { increment: 1 },
    },
  });
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: approve ? 'PRODUCT_APPROVED' : 'PRODUCT_APPROVAL_REJECTED',
    subjectType: 'PRODUCT',
    subjectId: id,
    organizationId: product.organizationId,
    reason: input.note,
  });
  return productApprovalView(updated);
}

export async function pendingProductApprovals(db: Tx) {
  const rows = await db.product.findMany({
    where: { approvalStatus: 'PENDING' },
    orderBy: { approvalRequestedAt: 'asc' },
    take: 200,
    include: { organization: { select: { name: true } } },
  });
  return { items: rows.map((r) => ({ ...productApprovalView(r), organizationName: r.organization?.name ?? null })) };
}
