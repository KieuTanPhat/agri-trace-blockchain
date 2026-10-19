import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { isPlatformAdminRole } from '../auth/role-codes.js';
import {
  effectiveSubscriptionStatus,
  entitlementFor,
  invoiceView,
  settingNumber,
  subscriptionView,
  usageFor,
} from '../billing/billing-core.js';
import { serviceStage } from '../enterprise-onboarding/enterprise-service.service.js';
import { capabilityRequestView } from '../enterprise-onboarding/enterprise-onboarding.service.js';
import { lotChainId } from '../lots/lot-origin.js';
import { downstreamLots, upstreamLots } from '../processing/processing-lineage.js';
import { SETTING_RULES } from './admin-controls.js';
import type { DirectoryQuery, LotSearchQuery, TraceReportQuery } from './platform-admin.dto.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const lastMonths = (n: number) => {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
    return monthKey(d);
  });
};
const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // Neutralise spreadsheet formulas and quote every cell.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replaceAll('"', '""')}"`;
};

/** Read-only aggregates for platform administrators. Nothing here mutates
 * business data; controls live in admin-controls.ts behind audited commands. */
@Injectable()
export class AdminInsightsService {
  constructor(private readonly db: PrismaService) {}

  async dashboard() {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const [
      orgByType,
      orgByStatus,
      orgByModel,
      capabilities,
      inbox,
      lotsTotal,
      lotsProcessed,
      runs30,
      scans7,
      blockedQr,
      outbox,
      proofs,
      holds,
      lastProof,
      lockedAccounts,
      recent,
      notices,
    ] = await Promise.all([
      this.db.organization.groupBy({ by: ['type'], _count: { _all: true } }),
      this.db.organization.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.organization.groupBy({ by: ['participationModel'], _count: { _all: true } }),
      this.db.organizationCapability.groupBy({ by: ['code'], where: { revokedAt: null }, _count: { _all: true } }),
      this.inbox(),
      this.db.lot.count(),
      this.db.lot.count({ where: { originType: 'TRANSFORMATION' } }),
      this.db.processingRun.count({ where: { status: 'COMPLETED', completedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
      this.db.traceScanDaily.aggregate({ where: { day: { gte: new Date(now.getTime() - 7 * DAY) } }, _sum: { scans: true } }),
      this.db.traceQrBlock.count({ where: { unblockedAt: null } }),
      this.db.blockchainOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.blockchainProof.groupBy({ by: ['transactionStatus'], _count: { _all: true } }),
      this.db.deliveryHold.count({ where: { resolvedAt: null } }),
      this.db.blockchainProof.findFirst({ where: { transactionStatus: 'CONFIRMED' }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true } }),
      this.db.user.count({ where: { lockedUntil: { gt: now } } }),
      this.db.platformAudit.findMany({ orderBy: { sequence: 'desc' }, take: 15 }),
      this.db.systemNotice.findMany({ where: { status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: { startsAt: 'desc' } }),
    ]);
    const graceDays = await settingNumber(this.db, 'billing.graceDays', 15);
    const reminderDays = await settingNumber(this.db, 'notifications.renewalReminderDays', 30);
    const subs = await this.db.subscription.findMany({ where: { status: 'ACTIVE' }, include: { organization: { select: { name: true } }, planVersion: { include: { plan: true } } } });
    const effective = subs.map((s) => ({ s, status: effectiveSubscriptionStatus(s, graceDays) }));
    const monthPaid = await this.db.invoice.findMany({ where: { status: 'PAID', paidAt: { gte: monthStart } }, select: { amount: true, simulated: true } });
    const outstanding = await this.db.invoice.aggregate({ where: { status: 'ISSUED' }, _sum: { amount: true } });
    const admins = await this.db.user.findMany({ where: { accountStatus: 'ACTIVE', role: { code: { in: ['SYSTEM_ADMIN', 'PLATFORM_OPERATOR', 'PLATFORM_CASE_MANAGER', 'PLATFORM_PRIVACY_OFFICER'] } } }, include: { platformMfa: true } });
    const count = <T extends { _count: { _all: number } }>(rows: T[], key: keyof T) =>
      Object.fromEntries(rows.map((r) => [String(r[key]), r._count._all]));
    return {
      generatedAt: now.toISOString(),
      organizations: {
        byType: count(orgByType, 'type'),
        byStatus: count(orgByStatus, 'status'),
        byModel: count(orgByModel, 'participationModel'),
        capabilities: count(capabilities, 'code'),
      },
      pending: inbox.summary,
      billing: {
        active: effective.filter((e) => e.status === 'ACTIVE').length,
        grace: effective.filter((e) => e.status === 'GRACE').length,
        restricted: effective.filter((e) => e.status === 'RESTRICTED').length,
        expiringSoon: effective
          .filter((e) => e.status === 'ACTIVE' && e.s.endsAt && e.s.endsAt.getTime() - now.getTime() < reminderDays * DAY)
          .map((e) => ({ organizationId: e.s.organizationId, organizationName: e.s.organization.name, planName: e.s.planVersion.plan.name, endsAt: iso(e.s.endsAt) })),
        monthRevenue: monthPaid.filter((i) => !i.simulated).reduce((a, i) => a + Number(i.amount), 0),
        monthSimulated: monthPaid.filter((i) => i.simulated).reduce((a, i) => a + Number(i.amount), 0),
        outstanding: Number(outstanding._sum.amount ?? 0),
      },
      traceability: {
        lots: lotsTotal,
        processedLots: lotsProcessed,
        processingRuns30Days: runs30,
        scans7Days: scans7._sum.scans ?? 0,
        blockedQr,
      },
      ledger: {
        outbox: count(outbox, 'status'),
        proofs: count(proofs, 'transactionStatus'),
        unresolvedHolds: holds,
        lastConfirmedAt: iso(lastProof?.recordedAt),
      },
      security: {
        lockedAccounts,
        adminsWithoutMfa: admins.filter((a) => a.platformMfa?.status !== 'ENABLED').length,
        admins: admins.length,
      },
      recentActivity: recent.map((a) => ({
        sequence: Number(a.sequence),
        occurredAt: a.occurredAt.toISOString(),
        action: a.action,
        actorRole: a.actorRole,
        subjectType: a.subjectType,
        subjectId: a.subjectId,
        organizationId: a.organizationId,
        outcome: a.outcome,
        reason: a.reason,
      })),
      notices: notices.map((n) => ({ id: n.id, title: n.title, severity: n.severity, audience: n.audience, endsAt: iso(n.endsAt) })),
    };
  }

  /** One queue for everything waiting on a platform decision, oldest first. */
  async inbox() {
    const now = Date.now();
    const enrollmentSla = await settingNumber(this.db, 'enrollment.reviewSlaHours', 48);
    const supportSla = await settingNumber(this.db, 'support.reviewSlaHours', 24);
    const [enrollments, capabilities, amendments, connections, approvals, tickets, reports, cases, invoices] = await Promise.all([
      this.db.enterpriseEnrollment.findMany({ where: { status: 'PENDING_REVIEW' }, include: { organization: { select: { name: true } } }, take: 200 }),
      this.db.capabilityRequest.findMany({ where: { status: 'PENDING' }, include: { organization: { select: { name: true, enterpriseEnrollment: { select: { id: true } } } } }, take: 200 }),
      this.db.enterpriseProfileAmendment.findMany({ where: { status: 'PENDING' }, take: 200 }),
      this.db.enterpriseConnection.findMany({ where: { status: 'PENDING_REVIEW' }, include: { enrollment: { include: { organization: { select: { name: true } } } } }, take: 200 }),
      this.db.platformApproval.findMany({ where: { status: 'PENDING', expiresAt: { gt: new Date() } }, take: 200 }),
      this.db.supportTicket.findMany({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, include: { organization: { select: { name: true } } }, take: 200 }),
      this.db.consumerReport.findMany({ where: { status: 'NEW' }, take: 200 }),
      this.db.platformCase.findMany({ where: { status: { in: ['OPEN', 'ESCALATED'] } }, include: { owner: { select: { name: true } } }, take: 200 }),
      this.db.invoice.findMany({ where: { status: 'ISSUED', dueAt: { lt: new Date() } }, include: { organization: { select: { name: true } } }, take: 200 }),
    ]);
    const orgNames = new Map(
      (await this.db.organization.findMany({ where: { id: { in: amendments.map((a) => a.organizationId) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]),
    );
    const item = (kind: string, id: string, title: string, organizationName: string | null, createdAt: Date, dueAt: Date | null, href: string) => ({
      kind,
      id,
      title,
      organizationName,
      createdAt: createdAt.toISOString(),
      dueAt: iso(dueAt),
      ageHours: Math.floor((now - createdAt.getTime()) / HOUR),
      overdue: !!dueAt && dueAt.getTime() < now,
      href,
    });
    const items = [
      ...enrollments.map((e) => item('ENROLLMENT', e.id, 'Hồ sơ đăng ký doanh nghiệp', e.organization.name, e.createdAt, new Date(e.createdAt.getTime() + enrollmentSla * HOUR), `/admin/enterprises/${e.id}`)),
      ...capabilities.map((c) => item('CAPABILITY', c.id, `Năng lực ${c.code}`, c.organization.name, c.createdAt, new Date(c.createdAt.getTime() + enrollmentSla * HOUR), c.organization.enterpriseEnrollment ? `/admin/enterprises/${c.organization.enterpriseEnrollment.id}` : '/admin/enterprises')),
      ...amendments.map((a) => item('AMENDMENT', a.id, 'Điều chỉnh hồ sơ', orgNames.get(a.organizationId) ?? null, a.createdAt, new Date(a.createdAt.getTime() + enrollmentSla * HOUR), `/admin/enterprises/amendments/${a.id}`)),
      ...connections.map((c) => item('CONNECTION', c.id, 'Kết nối blockchain', c.enrollment.organization.name, c.createdAt, new Date(c.createdAt.getTime() + enrollmentSla * HOUR), `/admin/enterprises/${c.enrollmentId}/connections/${c.id}`)),
      ...approvals.map((a) => item('APPROVAL', a.id, `Phê duyệt hai bước: ${a.operation}`, null, a.createdAt, a.expiresAt, `/admin/approvals/${a.id}`)),
      ...tickets.map((t) => item('TICKET', t.id, `${t.code}: ${t.subject}`, t.organization.name, t.createdAt, t.dueAt, `/admin/support/${t.id}`)),
      ...reports.map((r) => item('CONSUMER_REPORT', r.id, `Báo cáo từ người tiêu dùng (${r.category})`, null, r.createdAt, new Date(r.createdAt.getTime() + supportSla * HOUR), '/admin/reports')),
      ...cases.map((c) => item('CASE', c.id, `Sự cố #${c.caseNumber}: ${c.title}`, c.owner?.name ?? null, c.createdAt, c.responseDueAt, `/admin/cases/${c.id}`)),
      ...invoices.map((i) => item('INVOICE_OVERDUE', i.id, `Hóa đơn quá hạn ${i.number}`, i.organization.name, i.issuedAt, i.dueAt, '/admin/billing/invoices')),
    ].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.createdAt.localeCompare(b.createdAt));
    const summary = Object.fromEntries(
      ['ENROLLMENT', 'CAPABILITY', 'AMENDMENT', 'CONNECTION', 'APPROVAL', 'TICKET', 'CONSUMER_REPORT', 'CASE', 'INVOICE_OVERDUE'].map((k) => [k, items.filter((i) => i.kind === k).length]),
    );
    return { items, summary: { ...summary, total: items.length, overdue: items.filter((i) => i.overdue).length } };
  }

  async directory(query: DirectoryQuery) {
    const where: Prisma.OrganizationWhereInput = {
      type: { not: 'AUDITOR' },
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
      ...(query.status ? { status: query.status as 'ACTIVE' | 'INACTIVE' } : {}),
      ...(query.model ? { participationModel: query.model } : {}),
      ...(query.capability ? { capabilities: { some: { code: query.capability as never, revokedAt: null } } } : {}),
    };
    const orgs = await this.db.organization.findMany({
      where,
      include: {
        capabilities: { where: { revokedAt: null }, select: { code: true } },
        capabilityRequests: { where: { status: 'PENDING' }, select: { code: true } },
        enterpriseEnrollment: { include: { serviceOrder: true } },
        profile: { select: { province: true } },
        _count: { select: { users: true, ownedChains: true, chainMemberships: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const graceDays = await settingNumber(this.db, 'billing.graceDays', 15);
    const subs = await this.db.subscription.findMany({
      where: { organizationId: { in: orgs.map((o) => o.id) }, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
      include: { planVersion: { include: { plan: true } } },
    });
    const items = orgs.map((o) => {
      const sub = subs.find((s) => s.organizationId === o.id);
      return {
        id: o.id,
        name: o.name,
        type: o.type,
        status: o.status,
        version: o.version,
        participationModel: o.participationModel,
        capabilities: o.capabilities.map((c) => c.code),
        pendingCapabilities: o.capabilityRequests.map((c) => c.code),
        enrollmentId: o.enterpriseEnrollment?.id ?? null,
        stage: o.enterpriseEnrollment ? serviceStage(o.enterpriseEnrollment) : 'OPERATOR_PROVISIONED',
        planName: sub?.planVersion.plan.name ?? null,
        subscriptionStatus: sub ? effectiveSubscriptionStatus(sub, graceDays) : null,
        endsAt: iso(sub?.endsAt),
        province: o.profile?.province ?? null,
        members: o._count.users,
        ownedChains: o._count.ownedChains,
        chainMemberships: o._count.chainMemberships,
        createdAt: o.createdAt.toISOString(),
      };
    });
    return {
      items: query.plan ? items.filter((i) => i.subscriptionStatus === query.plan) : items,
    };
  }

  /** Everything administrators need about one organization on one page. */
  async organization(id: string) {
    const org = await this.db.organization.findUnique({
      where: { id },
      include: {
        profile: true,
        capabilities: true,
        capabilityRequests: { orderBy: { createdAt: 'asc' } },
        enterpriseEnrollment: { include: { serviceOrder: true, connections: { orderBy: { createdAt: 'desc' }, take: 20 } } },
        ownedChains: { select: { id: true, name: true, code: true, businessProfile: { select: { state: true } } } },
        chainMemberships: { include: { chain: { select: { id: true, name: true, code: true } } } },
        enterpriseSites: { select: { id: true, name: true, kind: true, status: true } },
      },
    });
    if (!org) throw new NotFoundException('Không tìm thấy tổ chức');
    const [members, entitlement, invoices, cases, tickets, audit, runs, lots] = await Promise.all([
      this.db.user.findMany({ where: { organizationId: id }, select: { id: true, fullName: true, email: true, accountStatus: true, enterpriseTier: true, createdAt: true, role: { select: { code: true } } }, orderBy: { createdAt: 'asc' }, take: 200 }),
      entitlementFor(this.db, id),
      this.db.invoice.findMany({ where: { organizationId: id }, orderBy: { issuedAt: 'desc' }, take: 50 }),
      this.db.platformCase.findMany({ where: { ownerOrganizationId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, caseNumber: true, title: true, status: true, severity: true, createdAt: true } }),
      this.db.supportTicket.findMany({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { id: true, code: true, subject: true, status: true, priority: true, createdAt: true } }),
      this.db.platformAudit.findMany({ where: { organizationId: id }, orderBy: { sequence: 'desc' }, take: 30 }),
      this.db.processingRun.count({ where: { organizationId: id, status: 'COMPLETED' } }),
      this.db.lot.count({ where: { farmOrgId: id } }),
    ]);
    return {
      id: org.id,
      name: org.name,
      type: org.type,
      status: org.status,
      version: org.version,
      participationModel: org.participationModel,
      createdAt: org.createdAt.toISOString(),
      profile: org.profile,
      capabilities: org.capabilities.map((c) => ({ code: c.code, revokedAt: iso(c.revokedAt), revision: c.revision, createdAt: c.createdAt.toISOString() })),
      capabilityRequests: org.capabilityRequests.map(capabilityRequestView),
      enrollment: org.enterpriseEnrollment
        ? {
            id: org.enterpriseEnrollment.id,
            status: org.enterpriseEnrollment.status,
            stage: serviceStage(org.enterpriseEnrollment),
            hostingMode: org.enterpriseEnrollment.hostingMode,
            createdAt: org.enterpriseEnrollment.createdAt.toISOString(),
            connections: org.enterpriseEnrollment.connections.map((c) => ({ id: c.id, chainId: c.chainId, status: c.status, createdAt: c.createdAt.toISOString() })),
          }
        : null,
      billing: {
        applies: entitlement.applies,
        paying: entitlement.paying,
        status: entitlement.status,
        limits: entitlement.limits,
        usage: await usageFor(this.db, id, entitlement.periodStart),
        subscription: entitlement.subscription ? await subscriptionView(this.db, { ...entitlement.subscription, organization: null }) : null,
        invoices: invoices.map(invoiceView),
      },
      chains: {
        owned: org.ownedChains.map((c) => ({ id: c.id, name: c.name, code: c.code, state: c.businessProfile?.state ?? null })),
        memberships: org.chainMemberships.map((m) => ({ chainId: m.chainId, name: m.chain.name, code: m.chain.code, status: m.status })),
      },
      sites: org.enterpriseSites,
      members: members.map((m) => ({ ...m, role: m.role.code, createdAt: m.createdAt.toISOString() })),
      activity: { lots, processingRuns: runs },
      cases: cases.map((c) => ({ ...c, caseNumber: Number(c.caseNumber), createdAt: c.createdAt.toISOString() })),
      tickets: tickets.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
      audit: audit.map((a) => ({ sequence: Number(a.sequence), occurredAt: a.occurredAt.toISOString(), action: a.action, actorRole: a.actorRole, reason: a.reason, outcome: a.outcome })),
    };
  }

  async chains() {
    const chains = await this.db.supplyChain.findMany({
      include: {
        owner: { select: { id: true, name: true } },
        businessProfile: { select: { state: true } },
        memberships: { include: { organization: { select: { capabilities: { where: { revokedAt: null }, select: { code: true } } } } } },
        ledgerProfile: { select: { activeBindingDigest: true } },
        _count: { select: { cycles: true, processingRuns: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    const openTransfers = await this.db.distributionTransfer.groupBy({
      by: ['chainId'],
      where: { status: { in: ['PROPOSED', 'READY', 'IN_TRANSIT'] } },
      _count: { _all: true },
    });
    return {
      items: chains.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        chainType: c.chainType,
        ownerId: c.owner.id,
        ownerName: c.owner.name,
        state: c.businessProfile?.state ?? 'NONE',
        members: c.memberships.filter((m) => m.status === 'ACTIVE').length,
        invited: c.memberships.filter((m) => m.status === 'INVITED').length,
        roles: [...new Set(c.memberships.flatMap((m) => m.organization.capabilities.map((x) => x.code)))],
        cycles: c._count.cycles,
        processingRuns: c._count.processingRuns,
        openTransfers: openTransfers.find((t) => t.chainId === c.id)?._count._all ?? 0,
        ledgerBound: !!c.ledgerProfile?.activeBindingDigest,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  async searchLots(query: LotSearchQuery) {
    const q = query.q.trim();
    const qr = await this.db.traceQr.findUnique({ where: { traceToken: q } });
    const lots = await this.db.lot.findMany({
      where: qr
        ? { id: qr.lotId }
        : { OR: [{ lotCode: { contains: q, mode: 'insensitive' } }, { product: { productName: { contains: q, mode: 'insensitive' } } }] },
      include: {
        product: { select: { productName: true } },
        organization: { select: { id: true, name: true } },
        harvest: { include: { cycle: { select: { chainId: true, farmId: true } } } },
        processingRun: { select: { chainId: true, siteId: true, code: true } },
        traceQr: { select: { traceToken: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const [blocks, scans, holders] = await Promise.all([
      this.db.traceQrBlock.findMany({ where: { lotId: { in: lots.map((l) => l.id) }, unblockedAt: null } }),
      this.db.traceScanDaily.groupBy({ by: ['lotId'], where: { lotId: { in: lots.map((l) => l.id) } }, _sum: { scans: true } }),
      this.db.lotHolding.findMany({ where: { lotId: { in: lots.map((l) => l.id) }, quantity: { gt: 0 } } }),
    ]);
    const holderNames = new Map(
      (await this.db.organization.findMany({ where: { id: { in: holders.map((h) => h.organizationId) } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]),
    );
    return {
      items: lots.map((l) => {
        const block = blocks.find((b) => b.lotId === l.id);
        return {
          lotId: l.id,
          lotCode: l.lotCode,
          productName: l.product.productName,
          organizationId: l.organization.id,
          organizationName: l.organization.name,
          originType: l.originType,
          runCode: l.processingRun?.code ?? null,
          chainId: lotChainId(l) ?? null,
          currentState: l.currentState,
          initialQuantity: l.initialQuantity.toFixed(3),
          availableQuantity: l.availableQuantity.toFixed(3),
          unit: l.unit,
          expiryDate: l.expiryDate?.toISOString().slice(0, 10) ?? null,
          createdAt: l.createdAt.toISOString(),
          traceToken: l.traceQr?.traceToken ?? null,
          qrBlock: block ? { id: block.id, version: block.version, reason: block.reason, publicMessage: block.publicMessage, blockedAt: block.blockedAt.toISOString() } : null,
          scans: scans.find((s) => s.lotId === l.id)?._sum.scans ?? 0,
          holders: holders.filter((h) => h.lotId === l.id).map((h) => ({ organizationId: h.organizationId, organizationName: holderNames.get(h.organizationId) ?? '', quantity: h.quantity.toFixed(3) })),
        };
      }),
    };
  }

  async lotLineage(lotId: string) {
    if (!(await this.db.lot.findUnique({ where: { id: lotId }, select: { id: true } })))
      throw new NotFoundException('Không tìm thấy lô');
    return { lotId, upstream: await upstreamLots(this.db, lotId), downstream: await downstreamLots(this.db, [lotId]) };
  }

  async qrOverview() {
    const [total, blocks, prints, scans] = await Promise.all([
      this.db.traceQr.count(),
      this.db.traceQrBlock.findMany({ orderBy: { blockedAt: 'desc' }, take: 200 }),
      this.db.traceLabelPrint.groupBy({ by: ['organizationId'], _sum: { copies: true }, _count: { _all: true } }),
      this.db.traceScanDaily.groupBy({ by: ['day'], where: { day: { gte: new Date(Date.now() - 30 * DAY) } }, _sum: { scans: true }, orderBy: { day: 'asc' } }),
    ]);
    const lots = await this.db.lot.findMany({ where: { id: { in: blocks.map((b) => b.lotId) } }, select: { id: true, lotCode: true, organization: { select: { name: true } }, product: { select: { productName: true } } } });
    const orgs = await this.db.organization.findMany({ where: { id: { in: prints.map((p) => p.organizationId) } }, select: { id: true, name: true } });
    return {
      totalQr: total,
      blocked: blocks.map((b) => {
        const lot = lots.find((l) => l.id === b.lotId);
        return { id: b.id, lotId: b.lotId, lotCode: lot?.lotCode, productName: lot?.product.productName, organizationName: lot?.organization.name, reason: b.reason, publicMessage: b.publicMessage, blockedAt: b.blockedAt.toISOString(), unblockedAt: iso(b.unblockedAt), unblockReason: b.unblockReason, version: b.version };
      }),
      printsByOrganization: prints
        .map((p) => ({ organizationId: p.organizationId, organizationName: orgs.find((o) => o.id === p.organizationId)?.name ?? '', prints: p._count._all, copies: p._sum.copies ?? 0 }))
        .sort((a, b) => b.copies - a.copies),
      scansByDay: scans.map((s) => ({ day: s.day.toISOString().slice(0, 10), scans: s._sum.scans ?? 0 })),
    };
  }

  async traceReport(query: TraceReportQuery) {
    const months = lastMonths(12);
    const since = new Date(months[0] + '-01T00:00:00Z');
    const [lots, events, proofs] = await Promise.all([
      this.db.lot.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, originType: true } }),
      this.db.traceEvent.groupBy({ by: ['eventType'], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.db.blockchainProof.groupBy({ by: ['transactionStatus'], _count: { _all: true } }),
    ]);
    const totalEvents = await this.db.traceEvent.count();
    const confirmed = proofs.find((p) => p.transactionStatus === 'CONFIRMED')?._count._all ?? 0;
    const result = {
      months: months.map((m) => ({
        month: m,
        harvestLots: lots.filter((l) => monthKey(l.createdAt) === m && l.originType === 'HARVEST').length,
        processedLots: lots.filter((l) => monthKey(l.createdAt) === m && l.originType === 'TRANSFORMATION').length,
      })),
      eventsByType: events.map((e) => ({ eventType: e.eventType, count: e._count._all })).sort((a, b) => b.count - a.count),
      proofs: Object.fromEntries(proofs.map((p) => [p.transactionStatus, p._count._all])),
      totalEvents,
      proofCoveragePercent: totalEvents ? Math.round((confirmed / totalEvents) * 1000) / 10 : 0,
      csv: null as string | null,
      fileName: null as string | null,
    };
    if (!query.export) return result;
    const from = query.from ? new Date(query.from + 'T00:00:00Z') : new Date(Date.now() - 90 * DAY);
    const to = query.to ? new Date(query.to + 'T23:59:59Z') : new Date();
    const rows = await this.db.lot.findMany({
      where: { createdAt: { gte: from, lte: to } },
      include: {
        product: { select: { productName: true } },
        organization: { select: { name: true } },
        harvest: { select: { harvestTime: true, cycle: { select: { chainId: true } } } },
        processingRun: { include: { inputs: { include: { lot: { select: { lotCode: true } } } } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 20000,
    });
    // Key data elements per lot (creation/transformation), FSMA 204 style.
    const header = ['lot_code', 'product', 'organization', 'origin_type', 'quantity', 'unit', 'created_at', 'harvest_or_processed_at', 'chain_id', 'processing_run', 'input_lots', 'expiry_date', 'state'];
    const lines = rows.map((l) => [
      l.lotCode,
      l.product.productName,
      l.organization.name,
      l.originType,
      l.initialQuantity.toFixed(3),
      l.unit,
      l.createdAt.toISOString(),
      iso(l.harvest?.harvestTime ?? l.processingRun?.completedAt),
      l.harvest?.cycle.chainId ?? l.processingRun?.chainId ?? '',
      l.processingRun?.code ?? '',
      l.processingRun?.inputs.map((i) => `${i.lot.lotCode}:${i.quantity.toFixed(3)} ${i.unit}`).join('; ') ?? '',
      l.expiryDate?.toISOString().slice(0, 10) ?? '',
      l.currentState,
    ]);
    result.csv = [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n');
    result.fileName = `agritrace-kde-${from.toISOString().slice(0, 10)}-${to.toISOString().slice(0, 10)}.csv`;
    return result;
  }

  async ledgerOverview() {
    const [routes, bindings, outbox, proofs, holds, jobs, lastConfirmed, lastFailed] = await Promise.all([
      this.db.ledgerRouteDefinition.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      this.db.fabricNetworkBinding.findMany({ include: { state: true, workerHealth: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.blockchainOutbox.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.blockchainProof.groupBy({ by: ['transactionStatus'], _count: { _all: true } }),
      this.db.deliveryHold.count({ where: { resolvedAt: null } }),
      this.db.ledgerControlJob.groupBy({ by: ['status'], _count: { _all: true } }),
      this.db.blockchainProof.findFirst({ where: { transactionStatus: 'CONFIRMED' }, orderBy: { recordedAt: 'desc' }, select: { recordedAt: true, txId: true } }),
      this.db.blockchainOutbox.findFirst({ where: { status: { in: ['RETRY', 'DEAD_LETTER'] } }, orderBy: { updatedAt: 'desc' }, select: { lastError: true, updatedAt: true, status: true } }),
    ]);
    const chainNames = new Map(
      (await this.db.supplyChain.findMany({ where: { id: { in: bindings.map((b) => b.chainId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
    );
    const oldest = await this.db.blockchainOutbox.findFirst({ where: { status: { in: ['PENDING', 'RETRY'] } }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } });
    return {
      routes: routes.map((r) => ({ digest: r.digest, mode: r.mode, network: r.network, channelId: r.channelId, chaincodeName: r.chaincodeName, contractName: r.contractName, writerMspId: r.writerMspId, createdAt: r.createdAt.toISOString() })),
      bindings: bindings.map((b) => ({
        digest: b.digest,
        chainId: b.chainId,
        chainName: chainNames.get(b.chainId) ?? null,
        network: b.network,
        channelId: b.channelId,
        chaincodeName: b.chaincodeName,
        writerMspId: b.writerMspId,
        writerRole: b.writerRole,
        status: b.state?.status ?? 'UNKNOWN',
        lastHealthyAt: iso(b.workerHealth?.lastHealthyAt),
        lastErrorCode: b.workerHealth?.lastErrorCode ?? null,
        certificateExpiresAt: iso(b.workerHealth?.certificateExpiresAt),
      })),
      outbox: Object.fromEntries(outbox.map((o) => [o.status, o._count._all])),
      proofs: Object.fromEntries(proofs.map((p) => [p.transactionStatus, p._count._all])),
      controlJobs: Object.fromEntries(jobs.map((j) => [j.status, j._count._all])),
      unresolvedHolds: holds,
      oldestPendingAgeMinutes: oldest ? Math.floor((Date.now() - oldest.createdAt.getTime()) / 60000) : 0,
      lastConfirmed: lastConfirmed ? { at: iso(lastConfirmed.recordedAt), txId: lastConfirmed.txId } : null,
      lastFailure: lastFailed ? { at: lastFailed.updatedAt.toISOString(), status: lastFailed.status, error: lastFailed.lastError?.slice(0, 300) ?? null } : null,
      note: 'Chỉ đọc. Phát lại, sửa binding hay giải phóng hold do operator thực hiện theo runbook Hybrid.',
    };
  }

  async ledgerTransactions(status?: string, q?: string) {
    const rows = await this.db.blockchainProof.findMany({
      where: {
        ...(status ? { transactionStatus: status as 'PENDING' | 'CONFIRMED' | 'FAILED' } : {}),
        ...(q ? { OR: [{ txId: { contains: q } }, { dataHash: { startsWith: q } }] } : {}),
      },
      include: { traceEvent: { select: { eventType: true, entityType: true, entityId: true, eventTime: true, actorOrganizationId: true, organization: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return {
      items: rows.map((p) => ({
        eventId: p.eventId,
        txId: p.txId,
        network: p.network,
        channelId: p.channelId,
        dataHash: p.dataHash,
        status: p.transactionStatus,
        attempts: p.attemptCount,
        recordedAt: iso(p.recordedAt),
        createdAt: p.createdAt.toISOString(),
        lastError: p.lastError?.slice(0, 300) ?? null,
        eventType: p.traceEvent.eventType,
        entityType: p.traceEvent.entityType,
        entityId: p.traceEvent.entityId,
        organizationName: p.traceEvent.organization?.name ?? null,
      })),
    };
  }

  async statistics() {
    const months = lastMonths(12);
    const since = new Date(months[0] + '-01T00:00:00Z');
    const [orgs, lots, runs, tickets, scans, invoices] = await Promise.all([
      this.db.organization.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true, type: true } }),
      this.db.lot.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.db.processingRun.findMany({ where: { completedAt: { gte: since } }, select: { completedAt: true } }),
      this.db.supportTicket.findMany({ where: { createdAt: { gte: since } }, select: { createdAt: true } }),
      this.db.traceScanDaily.findMany({ where: { day: { gte: since } }, select: { day: true, scans: true } }),
      this.db.invoice.findMany({ where: { status: 'PAID', paidAt: { gte: since } }, select: { paidAt: true, amount: true, simulated: true } }),
    ]);
    return {
      months: months.map((m) => ({
        month: m,
        organizations: orgs.filter((o) => monthKey(o.createdAt) === m).length,
        lots: lots.filter((l) => monthKey(l.createdAt) === m).length,
        processingRuns: runs.filter((r) => r.completedAt && monthKey(r.completedAt) === m).length,
        tickets: tickets.filter((t) => monthKey(t.createdAt) === m).length,
        scans: scans.filter((s) => monthKey(s.day) === m).reduce((a, s) => a + s.scans, 0),
        revenue: invoices.filter((i) => !i.simulated && monthKey(i.paidAt!) === m).reduce((a, i) => a + Number(i.amount), 0),
        simulatedRevenue: invoices.filter((i) => i.simulated && monthKey(i.paidAt!) === m).reduce((a, i) => a + Number(i.amount), 0),
      })),
      totals: {
        organizations: await this.db.organization.count({ where: { type: { not: 'AUDITOR' } } }),
        users: await this.db.user.count({ where: { accountStatus: 'ACTIVE' } }),
        chains: await this.db.supplyChain.count(),
        lots: await this.db.lot.count(),
        events: await this.db.traceEvent.count(),
      },
    };
  }

  async monitoring() {
    const started = Date.now();
    await this.db.$queryRaw`SELECT 1`;
    const dbLatencyMs = Date.now() - started;
    const now = Date.now();
    const [stuck, outboxDead, outboxRetry, mailPending, jobsFailed, sessions, holds] = await Promise.all([
      this.db.idempotencyRecord.count({ where: { status: 'PROCESSING', createdAt: { lt: new Date(now - 10 * 60_000) } } }),
      this.db.blockchainOutbox.count({ where: { status: 'DEAD_LETTER' } }),
      this.db.blockchainOutbox.count({ where: { status: 'RETRY' } }),
      this.db.enterpriseMail.count({ where: { status: 'PENDING' } }),
      this.db.ledgerControlJob.count({ where: { status: 'FAILED' } }),
      this.db.refreshSession.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.db.deliveryHold.count({ where: { resolvedAt: null } }),
    ]);
    const workers = await this.db.bindingWorkerHealth.findMany({ select: { bindingDigest: true, lastCheckedAt: true, lastHealthyAt: true, lastErrorCode: true } });
    const memory = process.memoryUsage();
    const checks = [
      { name: 'Cơ sở dữ liệu', status: dbLatencyMs < 200 ? 'OK' : 'SLOW', detail: `${dbLatencyMs} ms` },
      { name: 'Lệnh đang xử lý quá 10 phút', status: stuck ? 'WARN' : 'OK', detail: String(stuck) },
      { name: 'Outbox blockchain lỗi vĩnh viễn', status: outboxDead ? 'ALERT' : 'OK', detail: String(outboxDead) },
      { name: 'Outbox đang thử lại', status: outboxRetry ? 'WARN' : 'OK', detail: String(outboxRetry) },
      { name: 'Hold giao nhận sổ cái', status: holds ? 'WARN' : 'OK', detail: String(holds) },
      { name: 'Email chờ gửi', status: mailPending > 20 ? 'WARN' : 'OK', detail: String(mailPending) },
      { name: 'Ledger control job lỗi', status: jobsFailed ? 'ALERT' : 'OK', detail: String(jobsFailed) },
      ...workers.map((w) => ({
        name: `Worker binding ${w.bindingDigest.slice(0, 10)}`,
        status: w.lastErrorCode ? 'ALERT' : now - w.lastCheckedAt.getTime() > 15 * 60_000 ? 'WARN' : 'OK',
        detail: w.lastErrorCode ?? `kiểm tra lúc ${w.lastCheckedAt.toISOString()}`,
      })),
    ];
    return {
      generatedAt: new Date().toISOString(),
      api: { uptimeSeconds: Math.floor(process.uptime()), node: process.version, heapUsedMb: Math.round(memory.heapUsed / 1048576), rssMb: Math.round(memory.rss / 1048576) },
      activeSessions: sessions,
      checks,
    };
  }

  async securityAlerts() {
    const since = new Date(Date.now() - 7 * DAY);
    const [locked, risky, denied, sensitive, admins] = await Promise.all([
      this.db.user.findMany({ where: { lockedUntil: { gt: new Date() } }, select: { id: true, email: true, fullName: true, lockedUntil: true, failedLoginCount: true } }),
      this.db.user.findMany({ where: { failedLoginCount: { gte: 3 }, accountStatus: 'ACTIVE' }, select: { id: true, email: true, failedLoginCount: true } }),
      this.db.platformAudit.findMany({ where: { outcome: 'DENIED', occurredAt: { gte: since } }, orderBy: { sequence: 'desc' }, take: 100 }),
      this.db.platformAudit.findMany({
        where: {
          occurredAt: { gte: since },
          OR: [
            { action: { startsWith: 'APPROVAL_' } },
            { action: { in: ['USER_STATUS_CHANGED', 'USER_PASSWORD_RESET', 'ORGANIZATION_UPDATED', 'PLATFORM_SETTING_CHANGED', 'TRACE_QR_BLOCKED', 'CAPABILITY_REQUEST_APPROVED', 'INVOICE_PAYMENT_CONFIRMED', 'PLAN_VERSION_PUBLISHED', 'MFA_DISABLED'] } },
          ],
        },
        orderBy: { sequence: 'desc' },
        take: 100,
      }),
      this.db.user.findMany({ where: { accountStatus: 'ACTIVE' }, include: { role: true, platformMfa: true } }),
    ]);
    const audit = (a: (typeof denied)[number]) => ({ sequence: Number(a.sequence), occurredAt: a.occurredAt.toISOString(), action: a.action, actorRole: a.actorRole, actorUserId: a.actorUserId, subjectType: a.subjectType, reason: a.reason, outcome: a.outcome });
    return {
      lockedAccounts: locked.map((u) => ({ ...u, lockedUntil: iso(u.lockedUntil) })),
      repeatedFailures: risky,
      adminsWithoutMfa: admins.filter((u) => isPlatformAdminRole(u.role.code) && u.platformMfa?.status !== 'ENABLED').map((u) => ({ id: u.id, email: u.email, role: u.role.code })),
      deniedActions: denied.map(audit),
      sensitiveActions: sensitive.map(audit),
    };
  }

  /** Backups run on the host controller. The API only shows the receipt an
   * operator publishes to a read-only file; it never runs or restores backups. */
  async backupStatus() {
    const path = process.env.PLATFORM_BACKUP_STATUS_FILE;
    if (!path)
      return { available: false, note: 'Chưa cấu hình PLATFORM_BACKUP_STATUS_FILE. Sao lưu/khôi phục thực hiện qua controller theo production runbook.' };
    try {
      const receipt = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
      const allowed = ['lastBackupAt', 'revision', 'sha', 'scope', 'verifiedAt', 'status', 'host', 'retention'];
      return { available: true, receipt: Object.fromEntries(Object.entries(receipt).filter(([k]) => allowed.includes(k))), note: 'Chỉ đọc biên nhận do operator công bố.' };
    } catch {
      return { available: false, note: 'Không đọc được biên nhận sao lưu đã cấu hình.' };
    }
  }

  async settings() {
    const rows = await this.db.platformSetting.findMany({ orderBy: { key: 'asc' } });
    return {
      items: rows.map((r) => ({
        key: r.key,
        value: r.value,
        description: r.description,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
        editable: !!SETTING_RULES[r.key],
        hint: SETTING_RULES[r.key]?.hint ?? null,
      })),
    };
  }
}
