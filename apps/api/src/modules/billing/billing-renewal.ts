import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { mergeServiceContract } from '../enterprise-onboarding/service-contract-pdf.js';
import { appendPlatformAudit } from '../platform-governance/platform-audit.js';
import {
  invoiceView,
  issueInvoiceTx,
  normalizeLimits,
  usageFor,
} from './billing-core.js';

type Db = Prisma.TransactionClient;
export const RENEWAL_START_RULE = 'AFTER_CURRENT_TERM_OR_PAYMENT';

/** A preview is private, short-lived and immutable. Acceptance pins its exact PDF. */
export async function renewContractTx(
  tx: Db,
  actor: CommandActor,
  input: { planCode: string; contractDigest?: string; accepted?: boolean },
) {
  const organizationId = actor.organizationId!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${organizationId}`},0))`;
  const subscription = await tx.subscription.findFirst({
    where: { organizationId, status: 'ACTIVE' },
  });
  if (!subscription)
    throw new ConflictException(
      'Chưa có gói đang hoạt động để đăng ký kỳ tiếp theo',
    );
  if (
    await tx.subscriptionTerm.findFirst({
      where: {
        subscriptionId: subscription.id,
        status: { in: ['AWAITING_PAYMENT', 'SCHEDULED'] },
      },
    })
  )
    throw new ConflictException('Đã có hợp đồng hoặc gói chờ cho kỳ tiếp theo');
  if (
    await tx.invoice.findFirst({
      where: { subscriptionId: subscription.id, status: 'ISSUED' },
    })
  )
    throw new ConflictException(
      'Đã có hóa đơn chưa thanh toán; xử lý hóa đơn trước khi chọn gói khác',
    );
  const enrollment = await tx.enterpriseEnrollment.findUnique({
    where: { organizationId },
    include: { organization: { include: { profile: true } } },
  });
  if (!enrollment || enrollment.ownerId !== actor.sub)
    throw new ForbiddenException(
      'Chỉ chủ doanh nghiệp xác nhận hợp đồng gia hạn',
    );
  const order = await tx.enterpriseServiceOrder.findFirst({
    where: { enrollmentId: enrollment.id, cancelledAt: null },
    orderBy: { createdAt: 'desc' },
  });
  if (!order)
    throw new ConflictException(
      'Chưa có thông tin thanh toán của hợp đồng hiện tại',
    );
  const version = await tx.servicePlanVersion.findFirst({
    where: {
      planCode: input.planCode,
      status: 'PUBLISHED',
      plan: { status: 'ACTIVE' },
    },
    include: { plan: true },
  });
  if (!version) throw new NotFoundException('Gói không còn mở bán');
  const limits = normalizeLimits(version.limits);
  const quotation = {
    planVersionId: version.id,
    planCode: version.planCode,
    name: version.plan.name,
    version: version.version,
    termMonths: version.termMonths,
    setup: 0,
    annual: Number(version.annualFee),
    total: Number(version.annualFee),
    limits,
  };
  const source = {
    subscriptionId: subscription.id,
    subscriptionVersion: subscription.version,
    endsAt: subscription.endsAt?.toISOString() ?? null,
    quotation,
    organizationName: enrollment.organization.name,
    businessId: enrollment.businessId,
    representative:
      enrollment.organization.profile?.representative ??
      enrollment.organization.name,
    billingName: order.billingName,
    billingEmail: order.billingEmail,
    billingAddress: order.billingAddress,
    startRule: RENEWAL_START_RULE,
  };
  const sourceDigest = canonicalSha256(source);
  if (!input.contractDigest) {
    const id = randomUUID();
    const contractText = [
      `Gia hạn dịch vụ ${version.plan.name} (${version.planCode}), ${version.termMonths} tháng.`,
      `Phí duy trì đã gồm thuế: ${version.annualFee.toString()} VND. Không thu lại phí khởi tạo.`,
      `Kỳ mới bắt đầu khi kỳ hiện tại kết thúc và thanh toán đã được xác nhận; thanh toán muộn thì bắt đầu từ thời điểm xác nhận.`,
      `Hạn kỳ hiện tại: ${source.endsAt ?? 'Chưa xác định'}.`,
      `Hạn mức: ${limits.products} sản phẩm, ${limits.chains} chuỗi, ${limits.partners} đối tác, ${limits.members} thành viên.`,
      'Nếu vượt hạn mức tại ngày áp dụng, giữ nguyên dữ liệu và chỉ chặn tạo thêm tài nguyên vượt hạn mức cho đến khi mức dùng phù hợp.',
    ].join('\n');
    const pdf = await mergeServiceContract({
      organizationName: enrollment.organization.name,
      representative:
        enrollment.organization.profile?.representative ??
        enrollment.organization.name,
      businessId: enrollment.businessId,
      billingName: order.billingName,
      billingEmail: order.billingEmail,
      billingAddress: order.billingAddress,
      planName: quotation.name,
      planCode: version.planCode,
      termMonths: version.termMonths,
      setup: 0,
      annual: quotation.annual,
      total: quotation.total,
      limits,
      reference: id,
      renewalTerms: contractText,
    });
    const digest = canonicalSha256({
      sourceDigest,
      pdfSha256: pdf.sha256,
      templateVersion: pdf.templateVersion,
    });
    await tx.serviceContractPreview.create({
      data: {
        id,
        enrollmentId: enrollment.id,
        createdBy: actor.sub!,
        input: source,
        quotation,
        contractText,
        sourceDigest,
        contractDigest: digest,
        pdfBytes: pdf.bytes,
        pdfSha256: pdf.sha256,
        templateVersion: pdf.templateVersion,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    return {
      kind: 'RENEWAL_PREVIEW',
      planCode: version.planCode,
      planName: version.plan.name,
      contractDigest: digest,
      contractText,
      fileName: `gia-han-${version.planCode}.pdf`,
      mediaType: 'application/pdf',
      contentBase64: pdf.bytes.toString('base64'),
      sha256: pdf.sha256,
      limits,
      usage: await usageFor(tx, organizationId),
      effectiveAfter: source.endsAt,
    };
  }
  const preview = await tx.serviceContractPreview.findUnique({
    where: { contractDigest: input.contractDigest },
  });
  if (
    !preview ||
    preview.enrollmentId !== enrollment.id ||
    preview.createdBy !== actor.sub ||
    preview.expiresAt <= new Date() ||
    preview.sourceDigest !== sourceDigest
  )
    throw new ConflictException(
      'Hợp đồng hoặc gói đã thay đổi/hết hạn; xem lại hợp đồng trước khi xác nhận',
    );
  if (input.accepted !== true)
    throw new ConflictException('Cần xác nhận đồng ý hợp đồng gia hạn');
  const invoice = await issueInvoiceTx(tx, {
    organizationId,
    subscriptionId: subscription.id,
    planVersion: version,
    kind: 'RENEWAL',
    createdBy: actor.sub,
  });
  await tx.subscriptionTerm.create({
    data: {
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      planVersionId: version.id,
      contractPreviewId: preview.id,
      createdBy: actor.sub!,
    },
  });
  await appendPlatformAudit(tx, {
    actor,
    action: 'RENEWAL_CONTRACT_ACCEPTED',
    subjectType: 'INVOICE',
    subjectId: invoice.id,
    organizationId,
    details: {
      subscriptionId: subscription.id,
      planCode: version.planCode,
      contractDigest: preview.contractDigest,
      pdfSha256: preview.pdfSha256,
    },
  });
  return { ...invoiceView(invoice), resultKind: 'RENEWAL_INVOICE' };
}
