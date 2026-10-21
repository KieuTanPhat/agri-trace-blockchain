import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { isPlatformAdminRole } from '../auth/role-codes.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { appendPlatformAudit, lockPlatformAudit } from '../platform-governance/platform-audit.js';
import { settingNumber } from '../billing/billing-core.js';
import type {
  ConsumerReportInput,
  NoticeInput,
  ReferenceItemInput,
  ReportQuery,
  ReportTriageInput,
  TicketAssignInput,
  TicketCloseInput,
  TicketCreateInput,
  TicketQuery,
  TicketReplyInput,
} from './platform-admin.dto.js';

const HOUR = 3_600_000;
const PRIORITY_FACTOR: Record<string, number> = { URGENT: 0.25, HIGH: 0.5, NORMAL: 1, LOW: 2 };
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

type TicketRow = Prisma.SupportTicketGetPayload<{
  include: { organization: { select: { name: true } }; messages: true };
}>;
const ticketView = (t: TicketRow, platform: boolean, names: Map<string, string>) => ({
  id: t.id,
  code: t.code,
  organizationId: t.organizationId,
  organizationName: t.organization.name,
  category: t.category,
  priority: t.priority,
  subject: t.subject,
  status: t.status,
  assigneeId: t.assigneeId,
  assigneeName: t.assigneeId ? (names.get(t.assigneeId) ?? null) : null,
  dueAt: t.dueAt.toISOString(),
  overdue: !['RESOLVED', 'CLOSED'].includes(t.status) && t.dueAt.getTime() < Date.now(),
  resolution: t.resolution,
  closedAt: iso(t.closedAt),
  version: t.version,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
  messages: t.messages
    .filter((m) => platform || !m.internal)
    .map((m) => ({
      id: m.id,
      authorSide: m.authorSide,
      authorName: names.get(m.authorId) ?? null,
      body: m.body,
      internal: m.internal,
      createdAt: m.createdAt.toISOString(),
    })),
});

@Injectable()
export class SupportService {
  constructor(private readonly db: PrismaService) {}

  private async names(ids: string[]) {
    const rows = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
  private async ticketRows(where: Prisma.SupportTicketWhereInput, platform: boolean) {
    const rows = await this.db.supportTicket.findMany({
      where,
      include: { organization: { select: { name: true } }, messages: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
      take: 300,
    });
    const names = await this.names(rows.flatMap((r) => [...r.messages.map((m) => m.authorId), ...(r.assigneeId ? [r.assigneeId] : [])]));
    return rows.map((r) => ticketView(r, platform, names));
  }

  // ---------- Tickets: enterprise side ----------
  async myTickets(actor: CommandActor) {
    await enterpriseAuthority(this.db, actor, 'profile.read');
    return { items: await this.ticketRows({ organizationId: actor.organizationId! }, false) };
  }
  createTicket(actor: CommandActor, input: TicketCreateInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'profile.read', undefined, undefined, true);
      const sla = await settingNumber(tx, 'support.reviewSlaHours', 24);
      const [row] = await tx.$queryRaw<Array<{ n: bigint }>>`SELECT nextval('support_ticket_seq') AS n`;
      const ticket = await tx.supportTicket.create({
        data: {
          code: `HT-${String(row.n).padStart(6, '0')}`,
          organizationId: actor.organizationId!,
          createdBy: actor.sub!,
          category: input.category,
          priority: input.priority,
          subject: input.subject,
          dueAt: new Date(Date.now() + sla * (PRIORITY_FACTOR[input.priority] ?? 1) * HOUR),
          messages: { create: { authorId: actor.sub!, authorSide: 'ENTERPRISE', body: input.body } },
        },
      });
      return { record: { id: ticket.id, code: ticket.code } };
    });
  }
  replyAsEnterprise(actor: CommandActor, id: string, input: TicketReplyInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'profile.read', undefined, undefined, true);
      const ticket = await tx.supportTicket.findUnique({ where: { id } });
      if (!ticket || ticket.organizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
      if (ticket.status === 'CLOSED') throw new ConflictException('Yêu cầu đã đóng; tạo yêu cầu mới');
      if (input.internal) throw new ForbiddenException('Ghi chú nội bộ dành cho nhân sự nền tảng');
      const changed = await tx.supportTicket.updateMany({
        where: { id, version: input.version },
        data: { status: ticket.status === 'WAITING_CUSTOMER' || ticket.status === 'RESOLVED' ? 'IN_PROGRESS' : ticket.status, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('Yêu cầu đã thay đổi; tải lại');
      await tx.supportMessage.create({ data: { ticketId: id, authorId: actor.sub!, authorSide: 'ENTERPRISE', body: input.body } });
      return { record: { id } };
    });
  }

  // ---------- Tickets: platform side ----------
  async tickets(query: TicketQuery) {
    return { items: await this.ticketRows(query.status ? { status: query.status } : {}, true) };
  }
  async staff() {
    const rows = await this.db.user.findMany({
      where: { accountStatus: 'ACTIVE', role: { code: { in: ['SYSTEM_ADMIN', 'PLATFORM_CASE_MANAGER', 'PLATFORM_OPERATOR'] } } },
      select: { id: true, fullName: true, email: true, role: { select: { code: true } } },
      orderBy: { fullName: 'asc' },
    });
    return { items: rows.map((r) => ({ id: r.id, fullName: r.fullName, email: r.email, role: r.role.code })) };
  }
  assignTicket(actor: CommandActor, id: string, input: TicketAssignInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, include: { role: true } });
      if (!assignee || assignee.accountStatus !== 'ACTIVE' || !isPlatformAdminRole(assignee.role.code))
        throw new UnprocessableEntityException('Người phụ trách phải là nhân sự nền tảng đang hoạt động');
      const changed = await tx.supportTicket.updateMany({
        where: { id, version: input.version, status: { not: 'CLOSED' } },
        data: { assigneeId: assignee.id, ...(input.priority ? { priority: input.priority } : {}), status: 'IN_PROGRESS', version: { increment: 1 }, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('Yêu cầu đã thay đổi hoặc đã đóng');
      const ticket = await tx.supportTicket.findUniqueOrThrow({ where: { id } });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: 'TICKET_ASSIGNED', subjectType: 'SUPPORT_TICKET', subjectId: id, organizationId: ticket.organizationId, details: { assigneeId: assignee.id, priority: ticket.priority } });
      return { record: { id } };
    });
  }
  replyAsPlatform(actor: CommandActor, id: string, input: TicketReplyInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const ticket = await tx.supportTicket.findUnique({ where: { id } });
      if (!ticket) throw new NotFoundException('Không tìm thấy yêu cầu hỗ trợ');
      if (ticket.status === 'CLOSED') throw new ConflictException('Yêu cầu đã đóng');
      const changed = await tx.supportTicket.updateMany({
        where: { id, version: input.version },
        data: {
          status: input.internal ? ticket.status : (input.status ?? 'WAITING_CUSTOMER'),
          assigneeId: ticket.assigneeId ?? actor.sub,
          ...(input.status === 'RESOLVED' ? { resolution: input.body.slice(0, 2000) } : {}),
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new ConflictException('Yêu cầu đã thay đổi; tải lại');
      await tx.supportMessage.create({ data: { ticketId: id, authorId: actor.sub!, authorSide: 'PLATFORM', body: input.body, internal: !!input.internal } });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: input.internal ? 'TICKET_NOTE_ADDED' : 'TICKET_REPLIED', subjectType: 'SUPPORT_TICKET', subjectId: id, organizationId: ticket.organizationId, details: { status: input.status ?? null } });
      return { record: { id } };
    });
  }
  closeTicket(actor: CommandActor, id: string, input: TicketCloseInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const changed = await tx.supportTicket.updateMany({
        where: { id, version: input.version, status: { not: 'CLOSED' } },
        data: { status: 'CLOSED', closedAt: new Date(), resolution: input.reason, version: { increment: 1 }, updatedAt: new Date() },
      });
      if (changed.count !== 1) throw new ConflictException('Yêu cầu đã thay đổi hoặc đã đóng');
      const ticket = await tx.supportTicket.findUniqueOrThrow({ where: { id } });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: 'TICKET_CLOSED', subjectType: 'SUPPORT_TICKET', subjectId: id, organizationId: ticket.organizationId, reason: input.reason });
      return { record: { id } };
    });
  }

  // ---------- Consumer reports ----------
  /** Public, unauthenticated. Stores a keyed hash of the network source only to
   * rate-limit; the raw address is never stored. Retries with the same request
   * id return the same receipt. */
  async submitReport(token: string, input: ConsumerReportInput, source: string) {
    const qr = await this.db.traceQr.findUnique({ where: { traceToken: token } });
    if (!qr) throw new NotFoundException('Mã truy xuất không hợp lệ');
    if ((input.contactEmail || input.contactPhone) && !input.consent)
      throw new UnprocessableEntityException('Cần đồng ý xử lý thông tin liên hệ trước khi gửi');
    const secret = process.env.CONSUMER_REPORT_SECRET ?? process.env.JWT_SECRET ?? 'agritrace-consumer-report';
    const sourceHash = createHmac('sha256', secret).update(`${qr.lotId}\0${source}`).digest('hex');
    const existing = await this.db.consumerReport.findUnique({ where: { requestId: input.requestId } });
    if (existing) {
      if (existing.lotId !== qr.lotId) throw new ConflictException('Mã yêu cầu đã dùng cho mã QR khác');
      return { requestId: input.requestId, received: true };
    }
    const limit = await settingNumber(this.db, 'consumerReports.maxPerHour', 5);
    const recent = await this.db.consumerReport.count({
      where: { lotId: qr.lotId, sourceHash, createdAt: { gt: new Date(Date.now() - HOUR) } },
    });
    if (recent >= limit)
      throw new HttpException('Bạn đã gửi quá nhiều báo cáo cho sản phẩm này; vui lòng thử lại sau', HttpStatus.TOO_MANY_REQUESTS);
    await this.db.consumerReport.create({
      data: {
        lotId: qr.lotId,
        requestId: input.requestId,
        category: input.category,
        description: input.description,
        contactEmail: input.consent ? (input.contactEmail ?? null) : null,
        contactPhone: input.consent ? (input.contactPhone ?? null) : null,
        consent: input.consent,
        sourceHash,
      },
    }).catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    });
    return { requestId: input.requestId, received: true };
  }

  /** Contact data is shown only to staff who follow up on reports; auditors
   * see the report itself without the consumer's email or phone. */
  async reports(query: ReportQuery, showContact: boolean) {
    const rows = await this.db.consumerReport.findMany({
      where: query.status ? { status: query.status } : {},
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    const lots = await this.db.lot.findMany({
      where: { id: { in: rows.map((r) => r.lotId) } },
      select: { id: true, lotCode: true, farmOrgId: true, product: { select: { productName: true } }, organization: { select: { name: true } } },
    });
    return {
      items: rows.map((r) => {
        const lot = lots.find((l) => l.id === r.lotId);
        return {
          id: r.id,
          lotId: r.lotId,
          lotCode: lot?.lotCode ?? null,
          productName: lot?.product.productName ?? null,
          organizationName: lot?.organization.name ?? null,
          category: r.category,
          description: r.description,
          contactEmail: showContact ? r.contactEmail : null,
          contactPhone: showContact ? r.contactPhone : null,
          hasContact: !!(r.contactEmail || r.contactPhone),
          status: r.status,
          triageNote: r.triageNote,
          triagedAt: iso(r.triagedAt),
          caseId: r.caseId,
          version: r.version,
          createdAt: r.createdAt.toISOString(),
          sameSourceReports: rows.filter((x) => x.sourceHash === r.sourceHash).length,
        };
      }),
    };
  }

  /** Escalation opens a platform case assigned to the lot owner. Contact data
   * stays with the report and is never copied to the enterprise-visible case. */
  triageReport(actor: CommandActor, id: string, input: ReportTriageInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      await tx.$queryRaw`SELECT id FROM consumer_report WHERE id=${id}::uuid FOR UPDATE`;
      const report = await tx.consumerReport.findUnique({ where: { id } });
      if (!report || report.status !== 'NEW' || report.version !== input.version)
        throw new ConflictException('Báo cáo đã được xử lý hoặc đã thay đổi');
      let caseId: string | null = null;
      if (input.decision === 'ESCALATE') {
        const lot = await tx.lot.findUniqueOrThrow({ where: { id: report.lotId }, include: { organization: true } });
        const category = report.category === 'COUNTERFEIT' ? 'COUNTERFEIT' : report.category === 'SAFETY' ? 'SAFETY' : report.category === 'WRONG_INFORMATION' ? 'LABELING' : report.category === 'QUALITY' ? 'QUALITY' : 'OTHER';
        const ownerActive = lot.organization.status === 'ACTIVE';
        const created = await tx.platformCase.create({
          data: {
            title: `Phản ánh người tiêu dùng: lô ${lot.lotCode}`.slice(0, 200),
            description: report.description,
            category,
            severity: input.severity ?? 'MEDIUM',
            source: 'CONSUMER',
            status: ownerActive ? 'ASSIGNED' : 'OPEN',
            lotId: lot.id,
            ownerOrganizationId: ownerActive ? lot.farmOrgId : null,
            createdBy: actor.sub!,
          },
        });
        await tx.platformCaseEvent.create({ data: { caseId: created.id, action: 'CREATED', visibility: 'INTERNAL', actorUserId: actor.sub!, actorOrganizationId: null, note: input.note, details: { consumerReportId: report.id, category } } });
        if (ownerActive)
          await tx.platformCaseEvent.create({ data: { caseId: created.id, action: 'ASSIGNED', visibility: 'SHARED', actorUserId: actor.sub!, actorOrganizationId: null, note: 'Nền tảng chuyển phản ánh người tiêu dùng cho doanh nghiệp', details: { ownerOrganizationId: lot.farmOrgId } } });
        caseId = created.id;
      }
      await tx.consumerReport.update({
        where: { id },
        data: {
          status: input.decision === 'ESCALATE' ? 'ESCALATED' : input.decision === 'DISMISS' ? 'DISMISSED' : 'DUPLICATE',
          triageNote: input.note,
          triagedBy: actor.sub,
          triagedAt: new Date(),
          caseId,
          version: { increment: 1 },
        },
      });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: 'CONSUMER_REPORT_TRIAGED', subjectType: 'CONSUMER_REPORT', subjectId: id, reason: input.note, details: { decision: input.decision, caseId } });
      return { record: { id, caseId } };
    });
  }

  // ---------- System notices ----------
  async notices() {
    const rows = await this.db.systemNotice.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    return { items: rows.map((n) => ({ ...n, startsAt: n.startsAt.toISOString(), endsAt: n.endsAt.toISOString(), createdAt: n.createdAt.toISOString(), withdrawnAt: iso(n.withdrawnAt), active: n.status === 'PUBLISHED' && n.startsAt.getTime() <= Date.now() && n.endsAt.getTime() > Date.now() })) };
  }
  /** Banners for the signed-in viewer; independent of the controller write-lock. */
  async activeNotices(actor: CommandActor) {
    const now = new Date();
    const capabilities = actor.organizationId
      ? (await this.db.organizationCapability.findMany({ where: { organizationId: actor.organizationId, revokedAt: null }, select: { code: true } })).map((c) => c.code as string)
      : [];
    const audiences = ['ALL', ...(isPlatformAdminRole(actor.role) || actor.role === 'AUDITOR' ? ['PLATFORM'] : actor.organizationId ? ['ENTERPRISE', ...capabilities] : [])];
    const rows = await this.db.systemNotice.findMany({
      where: { status: 'PUBLISHED', startsAt: { lte: now }, endsAt: { gt: now }, audience: { in: audiences } },
      orderBy: [{ severity: 'desc' }, { startsAt: 'desc' }],
      take: 5,
    });
    return { items: rows.map((n) => ({ id: n.id, title: n.title, body: n.body, severity: n.severity, endsAt: n.endsAt.toISOString() })) };
  }
  publishNotice(actor: CommandActor, input: NoticeInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (endsAt <= startsAt || endsAt.getTime() < Date.now())
        throw new UnprocessableEntityException('Thời gian kết thúc phải sau thời gian bắt đầu và chưa qua');
      if (endsAt.getTime() - startsAt.getTime() > 90 * 24 * HOUR)
        throw new UnprocessableEntityException('Thông báo hiển thị tối đa 90 ngày');
      const row = await tx.systemNotice.create({ data: { ...input, startsAt, endsAt, createdBy: actor.sub! } });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: 'SYSTEM_NOTICE_PUBLISHED', subjectType: 'SYSTEM_NOTICE', subjectId: row.id, reason: input.title, details: { audience: input.audience, severity: input.severity, startsAt: input.startsAt, endsAt: input.endsAt } });
      return { record: { id: row.id } };
    });
  }
  withdrawNotice(actor: CommandActor, id: string, input: { version: number; reason: string }) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const changed = await tx.systemNotice.updateMany({ where: { id, version: input.version, status: 'PUBLISHED' }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawnBy: actor.sub, version: { increment: 1 } } });
      if (changed.count !== 1) throw new ConflictException('Thông báo đã thay đổi hoặc đã thu hồi');
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: 'SYSTEM_NOTICE_WITHDRAWN', subjectType: 'SYSTEM_NOTICE', subjectId: id, reason: input.reason });
      return { record: { id } };
    });
  }

  // ---------- Shared reference data ----------
  async referenceItems(category?: string, includeInactive = false) {
    const rows = await this.db.referenceItem.findMany({
      where: { ...(category ? { category } : {}), ...(includeInactive ? {} : { status: 'ACTIVE' }) },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
    return { items: rows.map((r) => ({ id: r.id, category: r.category, code: r.code, label: r.label, description: r.description, status: r.status, sortOrder: r.sortOrder, version: r.version, updatedAt: r.updatedAt.toISOString() })) };
  }
  upsertReference(actor: CommandActor, input: ReferenceItemInput) {
    return commandTransaction(this.db, async (tx) => {
      await lockPlatformAudit(tx);
      const current = await tx.referenceItem.findUnique({ where: { category_code: { category: input.category, code: input.code } } });
      if (current && current.version !== input.version) throw new ConflictException('Mục danh mục đã thay đổi; tải lại');
      if (!current && input.version !== undefined) throw new NotFoundException('Không tìm thấy mục danh mục');
      const data = { label: input.label, description: input.description ?? null, status: input.status, sortOrder: input.sortOrder, updatedBy: actor.sub, updatedAt: new Date() };
      const row = current
        ? await tx.referenceItem.update({ where: { id: current.id }, data: { ...data, version: { increment: 1 } } })
        : await tx.referenceItem.create({ data: { ...data, category: input.category, code: input.code } });
      await appendPlatformAudit(tx, { actor: { sub: actor.sub, role: actor.role }, action: current ? 'REFERENCE_ITEM_UPDATED' : 'REFERENCE_ITEM_CREATED', subjectType: 'REFERENCE_ITEM', subjectId: row.id, details: { category: input.category, code: input.code, label: input.label, status: input.status } });
      return { record: { id: row.id } };
    });
  }
}
