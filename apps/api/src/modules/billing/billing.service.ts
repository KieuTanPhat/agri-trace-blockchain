import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { appendPlatformAudit, lockPlatformAudit } from '../platform-governance/platform-audit.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { simulationEnabled } from '../enterprise-onboarding/service-catalog.js';
import {
  addMonths,
  audienceFor,
  effectiveSubscriptionStatus,
  entitlementFor,
  invoiceView,
  issueInvoiceTx,
  planVersionView,
  publishedCatalog,
  publishPlanVersionTx,
  settingNumber,
  settleInvoiceTx,
  subscriptionView,
  usageFor,
  voidInvoiceTx,
} from './billing-core.js';
import type {
  ConfirmPaymentInput,
  EnterpriseInvoicePayInput,
  EnterpriseRenewalInput,
  InvoiceQuery,
  InvoiceVersionInput,
  IssueRenewalInput,
  PlanVersionDraftInput,
  SubscriptionQuery,
} from './billing.dto.js';

const SUB_INCLUDE = {
  planVersion: { include: { plan: true } },
  organization: { select: { name: true } },
} as const;

@Injectable()
export class BillingService {
  constructor(private readonly db: PrismaService) {}

  // ---------- Platform administration ----------
  async plans() {
    const plans = await this.db.servicePlan.findMany({
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { sortOrder: 'asc' },
    });
    const counts = await this.db.subscription.groupBy({
      by: ['planVersionId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
    });
    return {
      items: plans.map((p) => ({
        code: p.code,
        name: p.name,
        audience: p.audience,
        description: p.description,
        status: p.status,
        versions: p.versions.map((v) => ({
          ...planVersionView(v),
          activeSubscriptions:
            counts.find((c) => c.planVersionId === v.id)?._count._all ?? 0,
        })),
      })),
    };
  }

  draftVersion(actor: CommandActor, planCode: string, input: PlanVersionDraftInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plan:${planCode}`},0))`;
      const plan = await tx.servicePlan.findUnique({ where: { code: planCode } });
      if (!plan || plan.status !== 'ACTIVE')
        throw new NotFoundException('Không tìm thấy gói đang mở bán');
      if (await tx.servicePlanVersion.findFirst({ where: { planCode, status: 'DRAFT' } }))
        throw new ConflictException('Gói đã có một phiên bản nháp chờ công bố');
      const last = await tx.servicePlanVersion.aggregate({
        where: { planCode },
        _max: { version: true },
      });
      const created = await tx.servicePlanVersion.create({
        data: {
          planCode,
          version: (last._max.version ?? 0) + 1,
          setupFee: BigInt(input.setupFee),
          annualFee: BigInt(input.annualFee),
          termMonths: input.termMonths,
          limits: { ...input.limits },
          note: input.note,
          createdBy: actor.sub,
        },
      });
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'PLAN_VERSION_DRAFTED',
        subjectType: 'SERVICE_PLAN_VERSION',
        subjectId: created.id,
        reason: input.note,
        details: { planCode, version: created.version, setupFee: input.setupFee, annualFee: input.annualFee, limits: { ...input.limits } },
      });
      return { record: planVersionView(created) };
    });
  }

  publishVersion(actor: CommandActor, versionId: string, reason: string) {
    return commandTransaction(this.db, async (tx) => ({
      record: planVersionView(await publishPlanVersionTx(tx, actor, versionId, reason)),
    }));
  }

  async subscriptions(query: SubscriptionQuery) {
    const graceDays = await settingNumber(this.db, 'billing.graceDays', 15);
    const rows = await this.db.subscription.findMany({
      where:
        query.status === 'PENDING_PAYMENT' || query.status === 'CANCELLED'
          ? { status: query.status }
          : query.status
            ? { status: 'ACTIVE' }
            : {},
      include: SUB_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const items = [];
    for (const row of rows) {
      const effective = effectiveSubscriptionStatus(row, graceDays);
      if (
        query.status === 'EXPIRING'
          ? !(effective === 'ACTIVE' && row.endsAt && row.endsAt.getTime() - Date.now() < 30 * 86_400_000)
          : query.status && !['PENDING_PAYMENT', 'CANCELLED'].includes(query.status) && effective !== query.status
      )
        continue;
      items.push(await subscriptionView(this.db, row));
    }
    return { items };
  }

  async invoices(query: InvoiceQuery) {
    const rows = await this.db.invoice.findMany({
      where: {
        ...(query.organizationId ? { organizationId: query.organizationId } : {}),
        ...(query.status === 'OVERDUE'
          ? { status: 'ISSUED', dueAt: { lt: new Date() } }
          : query.status
            ? { status: query.status }
            : {}),
      },
      include: { organization: { select: { name: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });
    return { items: rows.map(invoiceView) };
  }

  confirmPayment(actor: CommandActor, invoiceId: string, input: ConfirmPaymentInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      return {
        record: invoiceView(
          await settleInvoiceTx(tx, actor, invoiceId, {
            provider: 'MANUAL',
            version: input.version,
            reference: input.reference,
            note: input.reason,
          }),
        ),
      };
    });
  }

  voidInvoice(actor: CommandActor, invoiceId: string, input: InvoiceVersionInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      return { record: invoiceView(await voidInvoiceTx(tx, actor, invoiceId, input)) };
    });
  }

  issueRenewal(actor: CommandActor, organizationId: string, input: IssueRenewalInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const invoice = await renewalInvoiceTx(tx, organizationId, input.planCode, actor.sub);
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'INVOICE_ISSUED',
        subjectType: 'INVOICE',
        subjectId: invoice.id,
        organizationId,
        reason: input.reason,
        details: { number: invoice.number, kind: invoice.kind, amount: Number(invoice.amount) },
      });
      return { record: invoiceView(invoice) };
    });
  }

  async revenue(months = 12) {
    const since = addMonths(new Date(), -months + 1);
    since.setUTCDate(1);
    since.setUTCHours(0, 0, 0, 0);
    const paid = await this.db.invoice.findMany({
      where: { status: 'PAID', paidAt: { gte: since } },
      include: { planVersion: true },
    });
    const open = await this.db.invoice.findMany({ where: { status: 'ISSUED' } });
    const buckets = new Map<string, { month: string; paid: number; simulated: number; count: number }>();
    for (let i = 0; i < months; i++) {
      const d = addMonths(since, i);
      const key = d.toISOString().slice(0, 7);
      buckets.set(key, { month: key, paid: 0, simulated: 0, count: 0 });
    }
    const byPlan = new Map<string, { planCode: string; amount: number; count: number }>();
    for (const inv of paid) {
      const key = inv.paidAt!.toISOString().slice(0, 7);
      const bucket = buckets.get(key);
      const amount = Number(inv.amount);
      if (bucket) {
        bucket.count++;
        if (inv.simulated) bucket.simulated += amount;
        else bucket.paid += amount;
      }
      const code = inv.planVersion?.planCode ?? 'OTHER';
      const plan = byPlan.get(code) ?? { planCode: code, amount: 0, count: 0 };
      plan.amount += amount;
      plan.count++;
      byPlan.set(code, plan);
    }
    const graceDays = await settingNumber(this.db, 'billing.graceDays', 15);
    const subs = await this.db.subscription.findMany({ where: { status: 'ACTIVE' } });
    return {
      months: [...buckets.values()],
      byPlan: [...byPlan.values()].sort((a, b) => b.amount - a.amount),
      paidTotal: paid.filter((i) => !i.simulated).reduce((s, i) => s + Number(i.amount), 0),
      simulatedTotal: paid.filter((i) => i.simulated).reduce((s, i) => s + Number(i.amount), 0),
      outstandingTotal: open.reduce((s, i) => s + Number(i.amount), 0),
      overdueTotal: open.filter((i) => i.dueAt < new Date()).reduce((s, i) => s + Number(i.amount), 0),
      activeSubscriptions: subs.filter((s) => effectiveSubscriptionStatus(s, graceDays) === 'ACTIVE').length,
      expiringIn30Days: subs.filter(
        (s) => s.endsAt && s.endsAt > new Date() && s.endsAt.getTime() - Date.now() < 30 * 86_400_000,
      ).length,
      note: 'Doanh thu mô phỏng (thanh toán thử nghiệm) tách riêng; chỉ khoản xác nhận thủ công hoặc qua cổng thanh toán là tiền thật.',
    };
  }

  // ---------- Enterprise ----------
  async mine(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'profile.read');
    const organizationId = actor.organizationId!;
    const e = await entitlementFor(this.db, organizationId);
    const org = await this.db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const invoices = await this.db.invoice.findMany({
      where: { organizationId },
      orderBy: { issuedAt: 'desc' },
      take: 50,
    });
    return {
      applies: e.applies,
      paying: e.paying,
      status: e.status,
      limits: e.limits,
      usage: await usageFor(this.db, organizationId),
      subscription: e.subscription
        ? await subscriptionView(this.db, { ...e.subscription, organization: null })
        : null,
      invoices: invoices.map(invoiceView),
      plans: e.paying ? await publishedCatalog(this.db, audienceFor(org.participationModel)) : [],
      simulationEnabled: simulationEnabled(),
    };
  }

  requestRenewal(actor: CommandActor, input: EnterpriseRenewalInput) {
    return commandTransaction(this.db, async (tx) => {
      const auth = await enterpriseAuthority(tx, actor, 'profile.manage', undefined, undefined, true);
      if (!auth.primary)
        throw new ForbiddenException('Chỉ quản trị cấp 1 được gia hạn gói dịch vụ');
      return { record: invoiceView(await renewalInvoiceTx(tx, actor.organizationId!, input.planCode, actor.sub)) };
    });
  }

  paySimulated(actor: CommandActor, invoiceId: string, input: EnterpriseInvoicePayInput) {
    if (!simulationEnabled())
      throw new ForbiddenException(
        'Thanh toán mô phỏng chỉ bật trong môi trường local; cổng SePay chưa tích hợp',
      );
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice || invoice.organizationId !== actor.organizationId)
        throw new NotFoundException('Không tìm thấy hóa đơn');
      await payerAuthority(tx, actor);
      return {
        record: invoiceView(
          await settleInvoiceTx(tx, actor, invoiceId, {
            provider: 'SIMULATION',
            version: input.version,
            reference: `SIM-${invoice.number}`,
            note: 'Thanh toán mô phỏng local',
          }),
        ),
      };
    });
  }
}

/** Enrollment owners pay before activation; afterwards the level-1 admin does. */
async function payerAuthority(tx: Prisma.TransactionClient, actor: CommandActor) {
  const enrollment = await tx.enterpriseEnrollment.findUnique({
    where: { organizationId: actor.organizationId! },
  });
  if (enrollment?.ownerId === actor.sub && enrollment.status === 'APPROVED') return;
  const auth = await enterpriseAuthority(tx, actor, 'profile.manage', undefined, undefined, true);
  if (!auth.primary)
    throw new ForbiddenException('Chỉ quản trị cấp 1 được thanh toán hóa đơn');
}

/** One open renewal invoice per subscription; the plan must match the
 * organization's audience. Settlement extends the current term. */
export async function renewalInvoiceTx(
  tx: Prisma.TransactionClient,
  organizationId: string,
  planCode: string,
  createdBy: string | null,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing:${organizationId}`},0))`;
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const subscription = await tx.subscription.findFirst({
    where: { organizationId, status: 'ACTIVE' },
  });
  if (!subscription)
    throw new ConflictException('Tổ chức chưa có gói dịch vụ đang hiệu lực để gia hạn');
  if (await tx.invoice.findFirst({ where: { subscriptionId: subscription.id, status: 'ISSUED' } }))
    throw new ConflictException('Đã có hóa đơn chờ thanh toán cho gói này');
  const current = await tx.servicePlanVersion.findUniqueOrThrow({ where: { id: subscription.planVersionId } });
  if (current.planCode !== planCode && subscription.endsAt && subscription.endsAt > new Date())
    throw new ConflictException(
      `Kỳ ${current.planCode} còn hiệu lực đến ${subscription.endsAt.toISOString().slice(0, 10)}; gia hạn cùng gói, hoặc đổi gói sau khi kỳ hiện tại kết thúc (trong thời gian ân hạn)`,
    );
  const version = await tx.servicePlanVersion.findFirst({
    where: { planCode, status: 'PUBLISHED', plan: { status: 'ACTIVE', audience: audienceFor(org.participationModel) } },
    include: { plan: true },
  });
  if (!version) throw new NotFoundException('Gói không phù hợp mô hình tham gia của tổ chức');
  return issueInvoiceTx(tx, {
    organizationId,
    subscriptionId: subscription.id,
    planVersion: version,
    kind: 'RENEWAL',
    createdBy,
  });
}
