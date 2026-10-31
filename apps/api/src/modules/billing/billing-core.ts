import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type {
  Invoice,
  Prisma,
  ServicePlanVersion,
  Subscription,
} from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { payingParticipant } from '../enterprise-onboarding/registration-profile.dto.js';
import { enterprisePaymentsEnabled } from '../enterprise-onboarding/payment-policy.js';
import { appendPlatformAudit } from '../platform-governance/platform-audit.js';

type Db = Prisma.TransactionClient;
// QR label printing was retired; older plan versions may still carry a
// qrLabels key, which normalizeLimits ignores.
export const RESOURCES = ['products', 'chains', 'members'] as const;
export type Resource = (typeof RESOURCES)[number];
export type Limits = Record<Resource, number>;
export const RESOURCE_LABELS: Record<Resource, string> = {
  products: 'sản phẩm',
  chains: 'chuỗi truy xuất',
  members: 'thành viên',
};
export const PAYMENT_PROVIDERS = ['SIMULATION', 'MANUAL', 'SEPAY'] as const;
export type PaymentProvider = (typeof PAYMENT_PROVIDERS)[number];

const DAY = 86_400_000;
export const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
};

export async function settingValue<T>(db: Db, key: string, fallback: T) {
  const row = await db.platformSetting.findUnique({ where: { key } });
  return (row?.value as T | undefined) ?? fallback;
}
export async function settingNumber(db: Db, key: string, fallback: number) {
  const value = Number(await settingValue<unknown>(db, key, fallback));
  return Number.isFinite(value) ? value : fallback;
}

export function normalizeLimits(value: unknown): Limits {
  const raw = (value ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    RESOURCES.map((r) => {
      const n = Number(raw[r]);
      return [r, Number.isInteger(n) && n >= 0 ? n : 0];
    }),
  ) as Limits;
}

/** ACTIVE until endsAt, GRACE for the configured days after it, then
 * RESTRICTED. Pending or cancelled subscriptions grant nothing. */
export function effectiveSubscriptionStatus(
  sub: Pick<Subscription, 'status' | 'endsAt'>,
  graceDays: number,
  now = new Date(),
) {
  if (sub.status !== 'ACTIVE' || !sub.endsAt) return sub.status;
  if (now < sub.endsAt) return 'ACTIVE';
  if (now.getTime() < sub.endsAt.getTime() + graceDays * DAY) return 'GRACE';
  return 'RESTRICTED';
}

export const planVersionView = (v: ServicePlanVersion) => ({
  id: v.id,
  planCode: v.planCode,
  version: v.version,
  setupFee: Number(v.setupFee),
  annualFee: Number(v.annualFee),
  termMonths: v.termMonths,
  limits: normalizeLimits(v.limits),
  status: v.status,
  note: v.note,
  publishedAt: v.publishedAt?.toISOString() ?? null,
  createdAt: v.createdAt.toISOString(),
});

export const invoiceView = (
  i: Invoice & { organization?: { name: string } | null },
) => ({
  id: i.id,
  number: i.number,
  organizationId: i.organizationId,
  organizationName: i.organization?.name ?? null,
  subscriptionId: i.subscriptionId,
  planVersionId: i.planVersionId,
  kind: i.kind,
  lines: i.lines,
  amount: Number(i.amount),
  currency: i.currency,
  status: i.status,
  issuedAt: i.issuedAt.toISOString(),
  dueAt: i.dueAt.toISOString(),
  paidAt: i.paidAt?.toISOString() ?? null,
  provider: i.provider,
  providerReference: i.providerReference,
  simulated: i.simulated,
  voidReason: i.voidReason,
  overdue: i.status === 'ISSUED' && i.dueAt.getTime() < Date.now(),
  version: i.version,
});

export async function subscriptionView(
  db: Db,
  s: Subscription & {
    planVersion: ServicePlanVersion & { plan: { name: string } };
    organization?: { name: string } | null;
  },
) {
  const graceDays = await settingNumber(db, 'billing.graceDays', 15);
  return {
    id: s.id,
    organizationId: s.organizationId,
    organizationName: s.organization?.name ?? null,
    planCode: s.planVersion.planCode,
    planName: s.planVersion.plan.name,
    planVersion: planVersionView(s.planVersion),
    status: s.status,
    effectiveStatus: effectiveSubscriptionStatus(s, graceDays),
    startsAt: s.startsAt?.toISOString() ?? null,
    endsAt: s.endsAt?.toISOString() ?? null,
    graceEndsAt: s.endsAt
      ? new Date(s.endsAt.getTime() + graceDays * DAY).toISOString()
      : null,
    daysRemaining: s.endsAt
      ? Math.ceil((s.endsAt.getTime() - Date.now()) / DAY)
      : null,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    version: s.version,
  };
}

/** Published versions, optionally for one audience. */
export async function publishedCatalog(db: Db, audience?: string) {
  const plans = await db.servicePlan.findMany({
    where: { status: 'ACTIVE', ...(audience ? { audience } : {}) },
    include: { versions: { where: { status: 'PUBLISHED' } } },
    orderBy: { sortOrder: 'asc' },
  });
  return plans
    .filter((p) => p.versions.length === 1)
    .map((p) => ({
      code: p.code,
      name: p.name,
      audience: p.audience,
      description: p.description,
      version: planVersionView(p.versions[0]),
    }));
}

/** A quotation names exactly which published versions it was priced from. */
export const catalogDigest = (
  plans: Awaited<ReturnType<typeof publishedCatalog>>,
) =>
  'catalog-' +
  canonicalSha256(plans.map((p) => p.version.id).sort()).slice(0, 16);

export const audienceFor = (participationModel: string) =>
  participationModel === 'SUPPLY_CHAIN_ENTERPRISE'
    ? 'SUPPLY_CHAIN_ENTERPRISE'
    : 'PRODUCER';

async function activeCodes(db: Db, organizationId: string) {
  return (
    await db.organizationCapability.findMany({
      where: { organizationId, revokedAt: null },
      select: { code: true },
    })
  ).map((c) => c.code);
}

/** Entitlement of one organization. Organizations admitted before plan
 * enforcement (no capability review, no subscription) stay unrestricted. */
export async function entitlementFor(db: Db, organizationId: string) {
  const org = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      participationModel: true,
      _count: { select: { capabilityRequests: true } },
    },
  });
  if (!org) throw new NotFoundException('Không tìm thấy tổ chức');
  const subscription = await db.subscription.findFirst({
    where: { organizationId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    include: { planVersion: { include: { plan: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const codes = await activeCodes(db, organizationId);
  const reviewed = org._count.capabilityRequests > 0;
  const paying =
    !!subscription || payingParticipant(org.participationModel, codes);
  if ((!reviewed && !subscription) || (paying && !enterprisePaymentsEnabled()))
    return {
      applies: false,
      paying,
      status: 'UNRESTRICTED' as string,
      limits: null as Limits | null,
      periodStart: null as Date | null,
      subscription,
    };
  const graceDays = await settingNumber(db, 'billing.graceDays', 15);
  if (!paying)
    return {
      applies: true,
      paying,
      status: 'PARTICIPANT',
      limits: normalizeLimits(
        await settingValue(db, 'billing.participantLimits', {
          products: 30,
          chains: 0,
          members: 30,
        }),
      ),
      periodStart: new Date(Date.now() - 365 * DAY),
      subscription: null,
    };
  const status = subscription
    ? effectiveSubscriptionStatus(subscription, graceDays)
    : 'NONE';
  return {
    applies: true,
    paying,
    status,
    limits: subscription ? normalizeLimits(subscription.planVersion.limits) : null,
    periodStart:
      subscription?.endsAt != null
        ? addMonths(subscription.endsAt, -subscription.planVersion.termMonths)
        : null,
    subscription,
  };
}

export async function usageFor(
  db: Db,
  organizationId: string,
): Promise<Limits> {
  const [products, chains, members] = await Promise.all([
    db.product.count({ where: { organizationId, status: 'ACTIVE' } }),
    // The personal chain comes with activation and is outside the plan limit.
    db.supplyChain.count({ where: { ownerOrganizationId: organizationId, personal: false } }),
    db.user.count({ where: { organizationId, accountStatus: 'ACTIVE' } }),
  ]);
  return { products, chains, members };
}

/** Called in the creating command's transaction, after the enterprise lock,
 * so a concurrent create cannot exceed the plan. */
export async function assertEntitlement(
  tx: Db,
  organizationId: string,
  resource: Resource,
  add = 1,
) {
  const e = await entitlementFor(tx, organizationId);
  if (!e.applies) return;
  if (e.paying && !['ACTIVE', 'GRACE'].includes(e.status))
    throw new ForbiddenException(
      e.status === 'RESTRICTED'
        ? 'Gói dịch vụ đã hết hạn và qua thời gian ân hạn; gia hạn để tiếp tục tạo mới'
        : 'Tổ chức chưa có gói dịch vụ hiệu lực',
    );
  const limit = e.limits?.[resource] ?? 0;
  const used = (await usageFor(tx, organizationId))[resource];
  if (used + add > limit)
    throw new ForbiddenException(
      `Vượt hạn mức ${RESOURCE_LABELS[resource]} của gói (${used}/${limit}); nâng cấp hoặc liên hệ quản trị`,
    );
}

export async function nextInvoiceNumber(tx: Db) {
  const [row] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('invoice_number_seq') AS n`;
  return `AGT-${new Date().getUTCFullYear()}-${String(row.n).padStart(6, '0')}`;
}

export async function issueInvoiceTx(
  tx: Db,
  input: {
    organizationId: string;
    subscriptionId: string | null;
    planVersion: ServicePlanVersion & { plan: { name: string } };
    kind: 'INITIAL' | 'RENEWAL';
    createdBy: string | null;
  },
) {
  const dueDays = await settingNumber(tx, 'billing.invoiceDueDays', 15);
  const v = input.planVersion;
  const lines = [
    ...(input.kind === 'INITIAL' && v.setupFee > 0n
      ? [{ description: `Phí khởi tạo ${v.plan.name}`, amount: Number(v.setupFee) }]
      : []),
    {
      description: `Phí duy trì ${v.plan.name} (${v.termMonths} tháng, phiên bản ${v.version})`,
      amount: Number(v.annualFee),
    },
  ];
  return tx.invoice.create({
    data: {
      number: await nextInvoiceNumber(tx),
      organizationId: input.organizationId,
      subscriptionId: input.subscriptionId,
      planVersionId: v.id,
      kind: input.kind,
      lines,
      amount: BigInt(lines.reduce((sum, l) => sum + l.amount, 0)),
      dueAt: new Date(Date.now() + dueDays * DAY),
      createdBy: input.createdBy,
    },
  });
}

/** Marks an issued invoice paid and applies it to the subscription in the
 * same transaction. A provider reference can settle only one invoice. */
export async function settleInvoiceTx(
  tx: Db,
  actor: CommandActor | null,
  invoiceId: string,
  input: {
    provider: PaymentProvider;
    version: number;
    reference?: string | null;
    note?: string | null;
  },
) {
  await tx.$queryRaw`SELECT id FROM invoice WHERE id=${invoiceId}::uuid FOR UPDATE`;
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { planVersion: true },
  });
  if (!invoice) throw new NotFoundException('Không tìm thấy hóa đơn');
  if (invoice.status !== 'ISSUED' || invoice.version !== input.version)
    throw new ConflictException('Hóa đơn đã được xử lý hoặc đã thay đổi');
  const now = new Date();
  const paid = await tx.invoice.update({
    where: { id: invoiceId },
    data: {
      status: 'PAID',
      paidAt: now,
      provider: input.provider,
      providerReference: input.reference ?? null,
      simulated: input.provider === 'SIMULATION',
      version: { increment: 1 },
    },
  });
  await tx.invoicePayment.create({
    data: {
      invoiceId,
      provider: input.provider,
      amount: invoice.amount,
      reference: input.reference ?? null,
      recordedBy: actor?.sub ?? null,
      note: input.note ?? null,
    },
  });
  if (invoice.subscriptionId && invoice.planVersion) {
    const sub = await tx.subscription.findUniqueOrThrow({
      where: { id: invoice.subscriptionId },
    });
    const term = invoice.planVersion.termMonths;
    if (sub.status === 'PENDING_PAYMENT')
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'ACTIVE',
          startsAt: now,
          endsAt: addMonths(now, term),
          planVersionId: invoice.planVersion.id,
          version: { increment: 1 },
        },
      });
    else if (sub.status === 'ACTIVE') {
      const from = sub.endsAt && sub.endsAt > now ? sub.endsAt : now;
      // Limits follow the term that was paid for: another plan starts only
      // once the current term has ended (see renewalInvoiceTx).
      if (from > now && invoice.planVersion.planCode !== (await tx.servicePlanVersion.findUniqueOrThrow({ where: { id: sub.planVersionId } })).planCode)
        throw new ConflictException('Kỳ hiện tại còn hiệu lực; hóa đơn đổi gói chỉ thanh toán sau khi kỳ hiện tại kết thúc. Hủy hóa đơn này và gia hạn cùng gói.');
      await tx.subscription.update({
        where: { id: sub.id },
        data: {
          endsAt: addMonths(from, term),
          planVersionId: invoice.planVersion.id,
          version: { increment: 1 },
        },
      });
    } else
      throw new ConflictException('Gói dịch vụ đã hủy; không áp dụng thanh toán');
  }
  await appendPlatformAudit(tx, {
    actor: actor ? { sub: actor.sub, role: actor.role } : null,
    action:
      input.provider === 'SIMULATION'
        ? 'INVOICE_PAID_SIMULATED'
        : 'INVOICE_PAYMENT_CONFIRMED',
    subjectType: 'INVOICE',
    subjectId: invoiceId,
    organizationId: invoice.organizationId,
    reason: input.note ?? null,
    details: {
      number: invoice.number,
      amount: Number(invoice.amount),
      provider: input.provider,
      reference: input.reference ?? null,
      simulated: input.provider === 'SIMULATION',
    },
  });
  return paid;
}

export async function voidInvoiceTx(
  tx: Db,
  actor: CommandActor,
  invoiceId: string,
  input: { version: number; reason: string },
) {
  const changed = await tx.invoice.updateMany({
    where: { id: invoiceId, version: input.version, status: 'ISSUED' },
    data: {
      status: 'VOID',
      voidReason: input.reason,
      version: { increment: 1 },
    },
  });
  if (changed.count !== 1)
    throw new ConflictException('Hóa đơn đã được xử lý hoặc đã thay đổi');
  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
  });
  // The accepted contract still stands: a voided first invoice is replaced
  // by a corrected one at the contract's plan version, so the organization can
  // still pay and be activated.
  let replacement: { id: string; number: string } | null = null;
  if (invoice.subscriptionId && invoice.kind === 'INITIAL' && invoice.planVersionId) {
    const sub = await tx.subscription.findUnique({ where: { id: invoice.subscriptionId } });
    if (sub?.status === 'PENDING_PAYMENT')
      replacement = await issueInvoiceTx(tx, {
        organizationId: invoice.organizationId,
        subscriptionId: sub.id,
        planVersion: await tx.servicePlanVersion.findUniqueOrThrow({
          where: { id: invoice.planVersionId },
          include: { plan: true },
        }),
        kind: 'INITIAL',
        createdBy: actor.sub,
      });
  }
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'INVOICE_VOIDED',
    subjectType: 'INVOICE',
    subjectId: invoiceId,
    organizationId: invoice.organizationId,
    reason: input.reason,
    details: {
      number: invoice.number,
      amount: Number(invoice.amount),
      replacementNumber: replacement?.number ?? null,
    },
  });
  return invoice;
}

export async function publishPlanVersionTx(
  tx: Db,
  actor: CommandActor,
  versionId: string,
  reason: string,
) {
  const draft = await tx.servicePlanVersion.findUnique({
    where: { id: versionId },
  });
  if (!draft || draft.status !== 'DRAFT')
    throw new ConflictException('Chỉ công bố phiên bản nháp');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`plan:${draft.planCode}`},0))`;
  const previous = await tx.servicePlanVersion.findFirst({
    where: { planCode: draft.planCode, status: 'PUBLISHED' },
  });
  if (previous)
    await tx.servicePlanVersion.update({
      where: { id: previous.id },
      data: { status: 'RETIRED' },
    });
  const published = await tx.servicePlanVersion.update({
    where: { id: versionId },
    data: { status: 'PUBLISHED', publishedAt: new Date(), publishedBy: actor.sub },
  });
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'PLAN_VERSION_PUBLISHED',
    subjectType: 'SERVICE_PLAN_VERSION',
    subjectId: versionId,
    reason,
    details: {
      planCode: draft.planCode,
      version: draft.version,
      retired: previous?.id ?? null,
    },
  });
  return published;
}
