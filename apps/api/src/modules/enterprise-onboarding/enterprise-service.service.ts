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
  audienceFor,
  catalogDigest,
  issueInvoiceTx,
  publishedCatalog,
  settleInvoiceTx,
} from '../billing/billing-core.js';
import { payingParticipant } from './registration-profile.dto.js';
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

export const orderView = (r: EnterpriseServiceOrder) => ({
  id: r.id,
  planCode: r.planCode,
  hostingMode: r.hostingMode,
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
});
export const serviceStage = (r: {
  status: string;
  activationRequired: boolean;
  serviceActivatedAt?: Date | null;
  serviceOrder?: { status: string; hostingMode: string } | null;
}) =>
  r.status !== 'APPROVED'
    ? r.status
    : !r.activationRequired
      ? 'ACTIVE_LEGACY'
      : r.serviceActivatedAt ? 'ACTIVE' : 'AWAITING_ACTIVATION';
/** Paying participants are producers/cooperatives and supply-chain enterprises. */
export async function payingEnrollment(
  db: Prisma.TransactionClient,
  organizationId: string,
  participationModel: string,
) {
  const requests = await db.capabilityRequest.findMany({
    where: { organizationId, status: { in: ['PENDING', 'APPROVED'] } },
    select: { code: true },
  });
  // Enrollments created before per-capability review keep the paid flow.
  if (!requests.length) return true;
  return payingParticipant(
    participationModel,
    requests.map((r) => r.code),
  );
}
export async function enrollmentOwner(
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
/** Prices come from the published plan version for the organization's
 * participation model; the quotation records that version id. */
export async function previewService(
  db: Prisma.TransactionClient,
  org: { name: string; businessId: string | null; participationModel: string },
  input: ServiceQuoteInput,
) {
  const plans = await publishedCatalog(db, audienceFor(org.participationModel));
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
    products: plan.products,
    termMonths: plan.version.termMonths,
    currency: 'VND',
    setup: plan.setup,
    annual: plan.annual,
    total: plan.setup + plan.annual,
    qrIncluded: false,
    peerInfrastructureIncluded: false,
    tax: 'Chưa xác định — bản mô phỏng',
  };
  const contractText = [
    'AGRITRACE — HỢP ĐỒNG DỊCH VỤ ĐIỆN TỬ (BẢN MÔ PHỎNG LOCAL)',
    `Phiên bản điều khoản: ${SERVICE_CATALOG_VERSION}`,
    `Doanh nghiệp/chủ thể: ${org.name}. Mã số thuế: ${org.businessId ?? 'Chưa khai báo'}.`,
    `Tên thanh toán: ${input.billingName}. Địa chỉ thanh toán: ${input.billingAddress}. Email thanh toán: ${input.billingEmail}.`,
    `Dịch vụ: ${plan.name} (phiên bản giá ${plan.version.version}), kỳ hạn ${plan.version.termMonths} tháng; hạn mức ${plan.version.limits.products} sản phẩm, ${plan.version.limits.chains} chuỗi, ${plan.version.limits.members} thành viên, ${plan.version.limits.qrLabels} tem QR mỗi kỳ. Phí khởi tạo ${plan.setup.toLocaleString('vi-VN')} VND; duy trì ${plan.annual.toLocaleString('vi-VN')} VND; tổng tham khảo ${quotation.total.toLocaleString('vi-VN')} VND.`,
    `Mô hình peer: ${input.hostingMode === 'SELF_MANAGED_ORG' ? 'Doanh nghiệp tự vận hành peer' : 'AgriTrace quản lý peer'}. Phí QR, máy chủ/peer và thuế chưa bao gồm; cần báo giá riêng trước sử dụng thương mại.`,
    'Phạm vi: hồ sơ sản phẩm, vùng sản xuất, nhật ký, lô hàng, phân phối và truy xuất QR. Không bao gồm kế toán hoặc quản trị bán hàng.',
    'Doanh nghiệp chịu trách nhiệm về tính chính xác của dữ liệu và quản lý quyền nhân viên. Chỉ chia sẻ dữ liệu theo phạm vi được cấp. Thông tin pháp lý và liên hệ không công khai qua QR.',
    'Doanh nghiệp tự quản lý peer gửi endpoint, MSP và chứng thư CA công khai sau thanh toán; không gửi khóa riêng. Kết nối chỉ hoạt động sau khi vận hành kiểm chứng, không được tự động công nhận bằng thanh toán.',
    'Bản thử nghiệm không thu tiền, không phát hành hóa đơn, không tạo chữ ký số có chứng thư và không xác lập hợp đồng thương mại có hiệu lực. Không nhập số thẻ hay tài khoản ngân hàng.',
    'Thao tác xác nhận chỉ ghi nhận đồng ý thử nghiệm. Tích hợp chữ ký điện tử hợp lệ và NAPAS/QR thanh toán sẽ được thực hiện sau. Giá tham khảo không phải báo giá chính thức của iCheck.',
    'Nguồn cấu trúc giá: https://icheck.com.vn/chi-phi-trien-khai-truy-xuat-nguon-goc (giá tham khảo 07/08/2026, đối chiếu 17/10/2026).',
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
    const stage = row ? serviceStage(row) : 'ACTIVE_LEGACY';
    const owner = row?.ownerId === actor.sub;
    if (!['ACTIVE', 'ACTIVE_LEGACY'].includes(stage))
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
    const plans = await publishedCatalog(
      this.db,
      audienceFor(row.organization.participationModel),
    );
    const paying = await payingEnrollment(
      this.db,
      row.organizationId,
      row.organization.participationModel,
    );
    // A paying organization must buy a plan before the platform may activate
    // it (assertActivationReady), so its owner first sees the purchase steps.
    const base = serviceStage(row);
    const stage =
      base === 'AWAITING_ACTIVATION' && paying && !row.serviceOrder
        ? 'SELECT_SERVICE'
        : base === 'AWAITING_ACTIVATION' && paying && row.serviceOrder?.status === 'AWAITING_PAYMENT'
          ? 'AWAITING_PAYMENT'
          : base;
    return {
      stage,
      paying,
      catalog: serviceCatalog(plans, catalogDigest(plans)),
      order: row.serviceOrder ? orderView(row.serviceOrder) : null,
      emails,
    };
  }
  async preview(actor: CommandActor, input: ServiceQuoteInput) {
    const row = await enrollmentOwner(this.db, actor);
    if (row.status !== 'APPROVED')
      throw new ForbiddenException(
        'Hồ sơ phải được quản trị phê duyệt trước khi chọn dịch vụ',
      );
    if (
      !(await payingEnrollment(
        this.db,
        row.organizationId,
        row.organization.participationModel,
      ))
    )
      throw new ForbiddenException(
        'Tổ chức tham gia chuỗi không cần mua gói dịch vụ',
      );
    return previewService(
      this.db,
      {
        name: row.organization.name,
        businessId: row.businessId,
        participationModel: row.organization.participationModel,
      },
      input,
    );
  }
  create(actor: CommandActor, input: ServiceOrderInput) {
    return commandTransaction(this.db, async (tx) => {
      const row = await enrollmentOwner(tx, actor, true);
      if (row.status !== 'APPROVED')
        throw new ForbiddenException('Hồ sơ chưa được duyệt');
      if (!row.activationRequired || row.serviceOrder)
        throw new ConflictException(
          'Hồ sơ đã có hợp đồng hoặc đã được kích hoạt trước luồng dịch vụ này',
        );
      if (
        !(await payingEnrollment(
          tx,
          row.organizationId,
          row.organization.participationModel,
        ))
      )
        throw new ForbiddenException(
          'Tổ chức tham gia chuỗi không cần mua gói dịch vụ',
        );
      const snapshot = await previewService(
        tx,
        {
          name: row.organization.name,
          businessId: row.businessId,
          participationModel: row.organization.participationModel,
        },
        input,
      );
      if (snapshot.contractDigest !== input.contractDigest)
        throw new ConflictException(
          'Nội dung hợp đồng khác bản đã xem; cần xem lại',
        );
      const saved = await tx.enterpriseServiceOrder.create({
        data: {
          enrollmentId: row.id,
          planCode: input.planCode,
          hostingMode: input.hostingMode,
          billingEmail: input.billingEmail,
          billingName: input.billingName,
          billingAddress: input.billingAddress,
          amount: snapshot.quotation.total,
          ...snapshot,
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
          text: `Thanh toán mô phỏng đã hoàn tất. Không có tiền thật được thu. Hợp đồng đính kèm và tại trang Dịch vụ của doanh nghiệp. Mã đối chiếu: ${order.contractDigest}. ${order.hostingMode === 'SELF_MANAGED_ORG' ? 'Bạn có thể gửi cấu hình peer tại trang Kết nối sau khi tạo chuỗi.' : 'AgriTrace sẽ xử lý kết nối theo yêu cầu và kiểm chứng kỹ thuật.'}`,
          attachment: order.contractText,
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
