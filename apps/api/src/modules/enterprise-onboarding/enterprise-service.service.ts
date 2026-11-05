import { randomUUID } from 'node:crypto';
import { mergeServiceContract } from './service-contract-pdf.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { appendPlatformAudit } from '../platform-governance/platform-audit.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  Prisma,
  EnterpriseServiceOrder,
} from '../../generated/prisma/client.js';
import { serviceCatalog, simulationEnabled } from './service-catalog.js';
import {
  catalogDigest,
  issueInvoiceTx,
  publishedCatalog,
  settleInvoiceTx,
} from '../billing/billing-core.js';
import { chainOwner } from './registration-profile.dto.js';
import { activateEnrollmentTx } from './service-activation.js';
import {
  assertEnterprisePaymentsEnabled,
  serviceWorkspaceStage,
} from './payment-policy.js';
import { lockPlatformAudit } from '../platform-governance/platform-audit.js';
import type {
  ServiceOrderInput,
  ServicePaymentInput,
  ServiceQuoteInput,
} from './service-order.dto.js';
import {
  enterpriseAuthority,
  ENTERPRISE_PERMISSIONS,
} from '../enterprise-workspace/enterprise-policy.js';

const orderView = (r: EnterpriseServiceOrder) => ({
  id: r.id,
  planCode: r.planCode,
  billingEmail: r.billingEmail,
  billingName: r.billingName,
  billingAddress: r.billingAddress,
  amount: r.amount,
  quotation: r.quotation,
  contractText: r.contractText,
  contractDigest: r.contractDigest,
  status: r.status,
  version: r.version,
  acceptedAt: r.acceptedAt.toISOString(),
  paidAt: r.paidAt?.toISOString() ?? null,
  pdfSha256: r.contractPdfHash,
  templateVersion: r.contractTemplateVersion,
  hasPdf: r.contractPdf !== null,
});
const quoteInput = (input: ServiceQuoteInput): ServiceQuoteInput => ({
  planCode: input.planCode,
  catalogVersion: input.catalogVersion,
  billingName: input.billingName,
  billingEmail: input.billingEmail,
  billingAddress: input.billingAddress,
});
const previewView = (
  p: import('../../generated/prisma/client.js').ServiceContractPreview,
) => ({
  previewId: p.id,
  quotation: p.quotation,
  contractText: p.contractText,
  contractDigest: p.contractDigest,
  pdfSha256: p.pdfSha256,
  templateVersion: p.templateVersion,
  expiresAt: p.expiresAt.toISOString(),
  input: p.input,
});
export const serviceStage = (r: {
  status: string;
  serviceActivatedAt?: Date | null;
  serviceOrder?: { status: string } | null;
}) =>
  r.status !== 'APPROVED'
    ? r.status
    : r.serviceActivatedAt
      ? 'ACTIVE'
      : 'AWAITING_ACTIVATION';
/** Only chain owners buy a plan (ADR-005). */
const payingEnrollment = (participationStatus: string) =>
  chainOwner(participationStatus);
async function enrollmentOwner(
  db: Prisma.TransactionClient,
  actor: CommandActor,
  lock = false,
) {
  if (lock && actor.organizationId)
    await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${actor.organizationId}`},0))`;
  const row = await db.enterpriseEnrollment.findUnique({
    where: { ownerId: actor.sub! },
    include: {
      organization: { include: { profile: true } },
      serviceOrder: true,
    },
  });
  if (!row || row.organizationId !== actor.organizationId)
    throw new NotFoundException(
      'Chỉ quản trị viên cấp 1 có hồ sơ đăng ký được quản lý dịch vụ',
    );
  if (lock)
    await db.$queryRaw`SELECT id FROM enterprise_enrollment WHERE id=${row.id}::uuid FOR UPDATE`;
  return row;
}
/** Prices come from the published plan version; the quotation records that
 * version id. */
async function previewService(
  db: Prisma.TransactionClient,
  org: { name: string; businessId: string | null },
  input: ServiceQuoteInput,
) {
  const plans = await publishedCatalog(db);
  const SERVICE_CATALOG_VERSION = catalogDigest(plans);
  const plan = plans.find((p) => p.code === input.planCode);
  if (!plan || input.catalogVersion !== SERVICE_CATALOG_VERSION)
    throw new BadRequestException(
      'Bảng giá đã đổi hoặc gói không phù hợp; xem lại báo giá',
    );
  const quotation = {
    catalogVersion: SERVICE_CATALOG_VERSION,
    planCode: plan.code,
    planVersionId: plan.version.id,
    planVersion: plan.version.version,
    limits: plan.version.limits,
    name: plan.name,
    products: plan.version.limits.products,
    termMonths: plan.version.termMonths,
    currency: 'VND',
    setup: plan.version.setupFee,
    annual: plan.version.annualFee,
    total: plan.version.setupFee + plan.version.annualFee,
    qrIncluded: false,
    peerInfrastructureIncluded: false,
    tax: 'Chưa xác định — bản mô phỏng',
  };
  const contractText = [
    'AGRITRACE — HỢP ĐỒNG DỊCH VỤ THỬ NGHIỆM · service-test-v1',
    `Doanh nghiệp: ${org.name}. Mã số thuế: ${org.businessId ?? 'Chưa khai báo'}.`,
    `Tên thanh toán: ${input.billingName}. Địa chỉ: ${input.billingAddress}. Email: ${input.billingEmail}.`,
    `Gói ${plan.name} (${plan.code}), phiên bản giá ${plan.version.version}; thời hạn ${plan.version.termMonths} tháng.`,
    `Hạn mức ${plan.version.limits.products} sản phẩm, ${plan.version.limits.chains} chuỗi, ${plan.version.limits.members} thành viên.`,
    `Khởi tạo ${quotation.setup} VND; duy trì ${quotation.annual} VND; tổng giá gói ${quotation.total} VND. Thuế chưa xác định trong mẫu thử.`,
    'Điều kiện hợp tác nằm trong bản PDF đã điền thông tin. Mẫu phục vụ kiểm thử, chưa dùng để ký kết thương mại.',
  ].join('\n\n');
  return {
    quotation,
    contractText,
    contractDigest: canonicalSha256({ contractText, quotation }),
  };
}

@Injectable()
export class EnterpriseServiceService {
  constructor(private readonly db: PrismaService) {}
  async access(actor: CommandActor) {
    const row = actor.organizationId
      ? await this.db.enterpriseEnrollment.findUnique({
          where: { organizationId: actor.organizationId },
          include: { serviceOrder: true },
        })
      : null;
    // Organizations provisioned by the platform operator have no enrollment.
    const stage = row ? serviceStage(row) : 'OPERATOR_PROVISIONED';
    const owner = row?.ownerId === actor.sub;
    if (!['ACTIVE', 'OPERATOR_PROVISIONED'].includes(stage))
      return {
        stage,
        owner,
        primary: owner,
        tier: owner ? 1 : null,
        permissions: [],
        capabilities: [],
      };
    const auth = await enterpriseAuthority(this.db, actor, 'profile.read');
    const capabilities = await this.db.organizationCapability.findMany({
      where: { organizationId: actor.organizationId!, revokedAt: null },
      select: { code: true },
    });
    return {
      stage,
      owner,
      primary: auth.primary,
      tier: auth.user.enterpriseTier ?? (auth.primary ? 1 : null),
      permissions: auth.primary
        ? [...ENTERPRISE_PERMISSIONS]
        : [
            ...new Set(
              auth.user.enterpriseRoles.flatMap((r) => r.role.permissions),
            ),
          ],
      capabilities: capabilities.map((c) => c.code),
    };
  }
  async mine(actor: CommandActor) {
    const row = await enrollmentOwner(this.db, actor);
    const emails = await this.db.enterpriseMail.findMany({
      where: { enrollmentId: row.id },
      select: {
        kind: true,
        recipient: true,
        status: true,
        attempts: true,
        sentAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const plans = await publishedCatalog(this.db);
    const paying = payingEnrollment(row.organization.participationStatus);
    // Deferred collection has its own presentation; it never claims settlement.
    // A chain owner chooses and pays a plan before or after activation; only
    // CREATE_CHAIN waits for an ACTIVE subscription.
    const base = serviceWorkspaceStage(serviceStage(row));
    const open = ['AWAITING_ACTIVATION', 'ACTIVE'].includes(base);
    const stage =
      open && paying && !row.serviceOrder
        ? 'SELECT_SERVICE'
        : open && paying && row.serviceOrder?.status === 'AWAITING_PAYMENT'
          ? 'AWAITING_PAYMENT'
          : base;
    const latest = row.serviceOrder
      ? null
      : await this.db.serviceContractPreview.findFirst({
          where: {
            enrollmentId: row.id,
            createdBy: actor.sub!,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: 'desc' },
        });
    const history = await this.db.platformAudit.findMany({
      where: {
        organizationId: row.organizationId,
        action: {
          in: [
            'SERVICE_PLAN_SELECTED',
            'SERVICE_CONTRACT_PREVIEWED',
            'SERVICE_CONTRACT_ACCEPTED',
            'SERVICE_PAYMENT_SIMULATED',
            'SERVICE_PAYMENT_CONFIRMED',
            'ENTERPRISE_SERVICE_ACTIVATED',
          ],
        },
      },
      orderBy: { sequence: 'desc' },
      take: 50,
      select: { id: true, action: true, occurredAt: true, outcome: true },
    });
    return {
      stage,
      paying,
      latestPreview: latest ? previewView(latest) : null,
      history: history.map((h) => ({
        ...h,
        occurredAt: h.occurredAt.toISOString(),
      })),
      catalog: serviceCatalog(plans, catalogDigest(plans)),
      order: row.serviceOrder ? orderView(row.serviceOrder) : null,
      emails,
    };
  }
  preview(actor: CommandActor, input: ServiceQuoteInput) {
    return commandTransaction(
      this.db,
      async (tx) => {
        const row = await enrollmentOwner(tx, actor, true);
        assertEnterprisePaymentsEnabled();
        if (
          row.status !== 'APPROVED' ||
          !payingEnrollment(row.organization.participationStatus)
        )
          throw new ForbiddenException(
            'Chủ chuỗi có hồ sơ được duyệt mới được chọn dịch vụ',
          );
        if (row.serviceOrder)
          throw new ConflictException('Hồ sơ đã xác nhận hợp đồng');
        const snapshot = await previewService(
          tx,
          { name: row.organization.name, businessId: row.businessId },
          input,
        );
        const id = randomUUID();
        const representative =
          row.organization.profile?.representative ?? row.organization.name;
        const sourceDigest = canonicalSha256({
          digest: snapshot.contractDigest,
          representative,
        });
        const pdf = await mergeServiceContract({
          organizationName: row.organization.name,
          representative,
          businessId: row.businessId,
          ...quoteInput(input),
          planName: snapshot.quotation.name,
          termMonths: snapshot.quotation.termMonths,
          setup: snapshot.quotation.setup,
          annual: snapshot.quotation.annual,
          total: snapshot.quotation.total,
          limits: snapshot.quotation.limits,
          reference: id,
        });
        const saved = await tx.serviceContractPreview.create({
          data: {
            id,
            enrollmentId: row.id,
            createdBy: actor.sub!,
            input: { ...quoteInput(input) },
            quotation: snapshot.quotation,
            contractText: snapshot.contractText,
            sourceDigest,
            contractDigest: canonicalSha256({
              sourceDigest,
              pdfSha256: pdf.sha256,
              templateVersion: pdf.templateVersion,
            }),
            pdfBytes: pdf.bytes,
            pdfSha256: pdf.sha256,
            templateVersion: pdf.templateVersion,
            expiresAt: new Date(Date.now() + 30 * 60_000),
          },
        });
        for (const action of [
          'SERVICE_PLAN_SELECTED',
          'SERVICE_CONTRACT_PREVIEWED',
        ])
          await appendPlatformAudit(tx, {
            actor,
            action,
            subjectType: 'SERVICE_CONTRACT_PREVIEW',
            subjectId: id,
            organizationId: row.organizationId,
            details: {
              planCode: input.planCode,
              amount: snapshot.quotation.total,
              pdfSha256: pdf.sha256,
            },
          });
        return previewView(saved);
      },
      { timeout: 15000 },
    );
  }
  async document(actor: CommandActor, kind: string, id: string) {
    const row = await enrollmentOwner(this.db, actor);
    const file =
      kind === 'preview'
        ? await this.db.serviceContractPreview
            .findFirst({
              where: { id, enrollmentId: row.id, createdBy: actor.sub! },
              select: { pdfBytes: true, pdfSha256: true },
            })
            .then((p) => p && { bytes: p.pdfBytes, hash: p.pdfSha256 })
        : kind === 'order'
          ? await this.db.enterpriseServiceOrder
              .findFirst({
                where: { id, enrollmentId: row.id },
                select: { contractPdf: true, contractPdfHash: true },
              })
              .then(
                (p) =>
                  p?.contractPdf && {
                    bytes: p.contractPdf,
                    hash: p.contractPdfHash!,
                  },
              )
          : null;
    if (!file)
      throw new NotFoundException('Không có bản PDF trong phạm vi tài khoản');
    return {
      filename: 'hop-dong-agritrace.pdf',
      contentType: 'application/pdf',
      sha256: file.hash,
      contentBase64: Buffer.from(file.bytes).toString('base64'),
    };
  }
  create(actor: CommandActor, input: ServiceOrderInput) {
    return commandTransaction(this.db, async (tx) => {
      const row = await enrollmentOwner(tx, actor, true);
      assertEnterprisePaymentsEnabled();
      if (row.status !== 'APPROVED')
        throw new ForbiddenException('Hồ sơ chưa được duyệt');
      if (row.serviceOrder)
        throw new ConflictException('Hồ sơ đã có hợp đồng dịch vụ');
      if (!payingEnrollment(row.organization.participationStatus))
        throw new ForbiddenException('Thành viên không cần mua gói dịch vụ');
      const snapshot = await previewService(
        tx,
        {
          name: row.organization.name,
          businessId: row.businessId,
        },
        input,
      );
      const preview = await tx.serviceContractPreview.findUnique({
        where: { contractDigest: input.contractDigest },
      });
      const sourceDigest = canonicalSha256({
        digest: snapshot.contractDigest,
        representative:
          row.organization.profile?.representative ?? row.organization.name,
      });
      if (
        !preview ||
        preview.enrollmentId !== row.id ||
        preview.createdBy !== actor.sub ||
        preview.expiresAt <= new Date() ||
        preview.sourceDigest !== sourceDigest ||
        canonicalSha256(preview.input) !== canonicalSha256(quoteInput(input))
      )
        throw new ConflictException(
          'Hợp đồng hoặc bảng giá đã thay đổi/hết hạn; xem lại PDF trước khi xác nhận',
        );
      const saved = await tx.enterpriseServiceOrder.create({
        data: {
          enrollmentId: row.id,
          planCode: input.planCode,
          billingEmail: input.billingEmail,
          billingName: input.billingName,
          billingAddress: input.billingAddress,
          amount: snapshot.quotation.total,
          quotation: preview.quotation as Prisma.InputJsonValue,
          contractText: preview.contractText,
          contractDigest: preview.contractDigest,
          contractPdf: preview.pdfBytes,
          contractPdfHash: preview.pdfSha256,
          contractTemplateVersion: preview.templateVersion,
          acceptedAt: new Date(),
        },
      });
      // The accepted contract opens a pending subscription and its first invoice.
      const planVersion = await tx.servicePlanVersion.findUniqueOrThrow({
        where: { id: snapshot.quotation.planVersionId },
        include: { plan: true },
      });
      const subscription = await tx.subscription.create({
        data: {
          organizationId: row.organizationId,
          planVersionId: planVersion.id,
          sourceOrderId: saved.id,
        },
      });
      await issueInvoiceTx(tx, {
        organizationId: row.organizationId,
        subscriptionId: subscription.id,
        planVersion,
        kind: 'INITIAL',
        createdBy: actor.sub,
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'SERVICE_CONTRACT_ACCEPTED',
        subjectType: 'SERVICE_ORDER',
        subjectId: saved.id,
        organizationId: row.organizationId,
        details: {
          planCode: saved.planCode,
          amount: saved.amount,
          contractDigest: saved.contractDigest,
          pdfSha256: saved.contractPdfHash,
        },
      });
      return orderView(saved);
    });
  }
  pay(actor: CommandActor, input: ServicePaymentInput) {
    if (!simulationEnabled())
      throw new ForbiddenException(
        'Thanh toán mô phỏng chỉ được bật riêng trong môi trường local; cổng thanh toán thật chưa tích hợp',
      );
    return commandTransaction(this.db, async (tx) => {
      const row = await enrollmentOwner(tx, actor, true);
      const order = row.serviceOrder;
      if (row.status !== 'APPROVED' || !order)
        throw new ConflictException('Chưa có hợp đồng được xác nhận');
      if (
        order.status !== 'AWAITING_PAYMENT' ||
        order.version !== input.version ||
        order.contractDigest !== input.contractDigest
      )
        throw new ConflictException(
          'Hợp đồng đã đổi trạng thái; tải lại trước khi thanh toán',
        );
      const settled = await tx.enterpriseServiceOrder.update({
        where: { id: order.id },
        data: {
          status: 'PAID_SIMULATED',
          paidAt: new Date(),
          version: { increment: 1 },
        },
      });
      await lockPlatformAudit(tx);
      const subscription = await tx.subscription.findUnique({
        where: { sourceOrderId: order.id },
      });
      const invoice = subscription
        ? await tx.invoice.findFirst({
            where: {
              subscriptionId: subscription.id,
              kind: 'INITIAL',
              status: 'ISSUED',
            },
          })
        : null;
      if (invoice)
        await settleInvoiceTx(tx, actor, invoice.id, {
          provider: 'SIMULATION',
          version: invoice.version,
          reference: `SIM-${invoice.number}`,
          note: 'Thanh toán mô phỏng hợp đồng khởi tạo',
        });
      // A chain owner whose capabilities are all reviewed is activated by its
      // payment (ADR-005); otherwise the administrator activates after review.
      const requests = await tx.capabilityRequest.findMany({
        where: { organizationId: row.organizationId },
      });
      const reviewed =
        !requests.some((r) => r.status === 'PENDING') &&
        requests.some((r) => r.status === 'APPROVED');
      if (
        !row.serviceActivatedAt &&
        reviewed &&
        row.organization.participationStatus === 'CHAIN_OWNER'
      ) {
        const createChain = await activateEnrollmentTx(
          tx,
          row,
          actor.sub!,
          'Tự kích hoạt khi chủ chuỗi thanh toán gói dịch vụ',
        );
        await appendPlatformAudit(tx, {
          actor,
          action: 'ENTERPRISE_SERVICE_ACTIVATED',
          subjectType: 'ENTERPRISE_ENROLLMENT',
          subjectId: row.id,
          organizationId: row.organizationId,
          reason: 'Tự kích hoạt khi chủ chuỗi thanh toán gói dịch vụ',
          details: {
            manual: false,
            paymentVerified: false,
            simulated: true,
            participationStatus: 'CHAIN_OWNER',
            createChain,
          },
        });
      }
      const recipient = row.organization.profile?.contactEmail;
      if (!recipient)
        throw new ConflictException(
          'Hồ sơ chưa có email doanh nghiệp để nhận hợp đồng',
        );
      await tx.enterpriseMail.create({
        data: {
          enrollmentId: row.id,
          kind: 'CONTRACT',
          recipient,
          subject: 'AgriTrace — Hợp đồng điện tử sau thanh toán mô phỏng',
          text: `Thanh toán mô phỏng đã hoàn tất. Không có tiền thật được thu. Hợp đồng đính kèm và tại trang Dịch vụ của doanh nghiệp. Mã đối chiếu: ${order.contractDigest}. AgriTrace tự chuẩn bị kết nối blockchain sau khi dịch vụ được kích hoạt.`,
          attachment: order.contractPdf ? null : order.contractText,
          attachmentPdf: order.contractPdf,
          attachmentPdfHash: order.contractPdfHash,
        },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'SERVICE_PAYMENT_SIMULATED',
        subjectType: 'SERVICE_ORDER',
        subjectId: settled.id,
        organizationId: row.organizationId,
        details: {
          simulated: true,
          status: settled.status,
          contractDigest: settled.contractDigest,
        },
      });
      return orderView(settled);
    });
  }
}
