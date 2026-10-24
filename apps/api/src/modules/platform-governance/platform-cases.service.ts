import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import type {
  AssignCaseDto,
  CaseListQueryDto,
  CaseNoteDto,
  ClassifyCaseDto,
  CloseCaseDto,
  CreateCaseDto,
  EnterpriseCaseAckDto,
  EnterpriseCaseResponseDto,
  EscalateCaseDto,
  LinkCaseLotDto,
} from './case.dto.js';
import { appendPlatformAudit, lockPlatformAudit } from './platform-audit.js';

/** A case is a request and a notification. Nothing in this service reads or
 * writes lot state, quantity, custody or recall: those commands stay with the
 * owning enterprise (FARM_STAFF/TRANSPORTER/RETAILER). */
const OPEN_FOR_RESPONSE = ['ASSIGNED', 'ACKNOWLEDGED', 'ESCALATED'] as const;
const PLATFORM_ROLES = ['SYSTEM_ADMIN', 'AUDITOR', 'COMPLIANCE_REVIEWER'];

type CaseRow = Prisma.PlatformCaseGetPayload<{
  include: {
    owner: { select: { id: true; name: true } };
    lot: { select: { id: true; lotCode: true } };
  };
}>;
const CASE_INCLUDE = {
  owner: { select: { id: true, name: true } },
  lot: { select: { id: true, lotCode: true } },
} as const;

const overdue = (row: { status: string; responseDueAt: Date | null }) =>
  !!row.responseDueAt &&
  row.responseDueAt.getTime() < Date.now() &&
  (OPEN_FOR_RESPONSE as readonly string[]).includes(row.status);

function futureDate(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now())
    throw new UnprocessableEntityException('Hạn phản hồi phải ở tương lai');
  return date;
}

function caseView(row: CaseRow) {
  return {
    id: row.id,
    caseNumber: Number(row.caseNumber),
    title: row.title,
    description: row.description,
    category: row.category,
    severity: row.severity,
    source: row.source,
    status: row.status,
    lot: row.lot,
    owner: row.owner,
    responseDueAt: row.responseDueAt,
    acknowledgedAt: row.acknowledgedAt,
    respondedAt: row.respondedAt,
    escalatedAt: row.escalatedAt,
    closedAt: row.closedAt,
    closeReason: row.closeReason,
    overdue: overdue(row),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function encodeCursor(id: string) {
  return Buffer.from(id, 'utf8').toString('base64url');
}
function decodeCursor(cursor: string | undefined) {
  if (!cursor) return undefined;
  const id = Buffer.from(cursor, 'base64url').toString('utf8');
  if (!isUUID(id))
    throw new UnprocessableEntityException('Cursor không hợp lệ');
  return id;
}

@Injectable()
export class PlatformCasesService {
  constructor(private readonly prisma: PrismaService) {}

  organizationOptions() {
    return this.prisma.organization.findMany({
      where: { status: 'ACTIVE', type: { not: 'AUDITOR' } },
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
  }

  private event(
    tx: Prisma.TransactionClient,
    caseId: string,
    actor: { sub: string | null; organizationId?: string | null },
    action: string,
    visibility: 'INTERNAL' | 'SHARED',
    note: string,
    details: Record<string, unknown> = {},
  ) {
    return tx.platformCaseEvent.create({
      data: {
        caseId,
        action,
        visibility,
        actorUserId: actor.sub!,
        actorOrganizationId: actor.organizationId ?? null,
        note,
        details: details as Prisma.InputJsonObject,
      },
    });
  }

  private async lockedCase(
    tx: Prisma.TransactionClient,
    id: string,
    version?: number,
  ) {
    await tx.$queryRaw`SELECT platform_case_id FROM platform_case WHERE platform_case_id = ${id}::uuid FOR UPDATE`;
    const row = await tx.platformCase.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Không tìm thấy hồ sơ');
    if (row.status === 'CLOSED')
      throw new ConflictException('Hồ sơ đã đóng và không thể thay đổi');
    if (version !== undefined && row.version !== version)
      throw new ConflictException('Hồ sơ đã thay đổi; tải lại trạng thái');
    return row;
  }

  private async activeOwner(tx: Prisma.TransactionClient, id: string) {
    const org = await tx.organization.findUnique({ where: { id } });
    if (!org || org.status !== 'ACTIVE' || org.type === 'AUDITOR')
      throw new UnprocessableEntityException(
        'Tổ chức được giao phải là doanh nghiệp đang hoạt động',
      );
    return org;
  }

  private async existingLot(tx: Prisma.TransactionClient, id: string) {
    const lot = await tx.lot.findUnique({
      where: { id },
      select: { id: true, farmOrgId: true },
    });
    if (!lot) throw new UnprocessableEntityException('Không tìm thấy lô');
    return lot;
  }

  private async reload(tx: Prisma.TransactionClient, id: string) {
    return caseView(
      await tx.platformCase.findUniqueOrThrow({
        where: { id },
        include: CASE_INCLUDE,
      }),
    );
  }

  // ------------------------------------------------------------ platform side

  create(actor: CommandActor, input: CreateCaseDto) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      const due = futureDate(input.responseDueAt);
      const lot = input.lotId ? await this.existingLot(tx, input.lotId) : null;
      // Hand the case to whoever owns the lot unless the administrator says
      // otherwise; without a lot or owner it stays OPEN for triage.
      const ownerId = input.ownerOrganizationId ?? lot?.farmOrgId ?? null;
      if (ownerId) await this.activeOwner(tx, ownerId);
      if (due && !ownerId)
        throw new UnprocessableEntityException(
          'Hạn phản hồi cần có tổ chức được giao',
        );
      const created = await tx.platformCase.create({
        data: {
          title: input.title,
          description: input.description,
          category: input.category,
          severity: input.severity,
          source: input.source,
          status: ownerId ? 'ASSIGNED' : 'OPEN',
          lotId: lot?.id,
          ownerOrganizationId: ownerId,
          responseDueAt: due,
          createdBy: actor.sub!,
        },
      });
      await this.event(
        tx,
        created.id,
        actor,
        'CREATED',
        'INTERNAL',
        input.title,
        {
          category: input.category,
          severity: input.severity,
          source: input.source,
        },
      );
      if (ownerId)
        await this.event(
          tx,
          created.id,
          actor,
          'ASSIGNED',
          'SHARED',
          'Nền tảng giao hồ sơ cho doanh nghiệp',
          {
            ownerOrganizationId: ownerId,
            responseDueAt: due?.toISOString() ?? null,
          },
        );
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'CASE_CREATED',
        subjectType: 'PLATFORM_CASE',
        subjectId: created.id,
        organizationId: ownerId,
        reason: input.title,
        details: {
          caseNumber: Number(created.caseNumber),
          category: input.category,
          severity: input.severity,
          lotId: lot?.id ?? null,
        },
      });
      return this.reload(tx, created.id);
    });
  }

  async list(query: CaseListQueryDto) {
    const limit = query.limit ?? 25;
    const where: Prisma.PlatformCaseWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.organizationId
        ? { ownerOrganizationId: query.organizationId }
        : {}),
      ...(query.overdue
        ? {
            responseDueAt: { lt: new Date() },
            status: { in: [...OPEN_FOR_RESPONSE] },
          }
        : {}),
    };
    const rows = await this.prisma.platformCase.findMany({
      where,
      include: CASE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      cursor: query.cursor ? { id: decodeCursor(query.cursor) } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(caseView),
      nextCursor:
        rows.length > limit ? encodeCursor(page[page.length - 1].id) : null,
    };
  }

  async get(id: string) {
    const row = await this.prisma.platformCase.findUnique({
      where: { id },
      include: {
        ...CASE_INCLUDE,
        events: {
          orderBy: { createdAt: 'asc' },
          include: {
            actor: { select: { id: true, fullName: true } },
            organization: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Không tìm thấy hồ sơ');
    return {
      ...caseView(row),
      events: row.events.map((event) => ({
        id: event.id,
        action: event.action,
        visibility: event.visibility,
        actor: event.actor,
        organization: event.organization,
        note: event.note,
        details: event.details,
        createdAt: event.createdAt,
      })),
    };
  }

  classify(actor: CommandActor, id: string, input: ClassifyCaseDto) {
    return this.mutate(
      actor,
      id,
      input.version,
      'CASE_CLASSIFIED',
      async (tx, row) => {
        await tx.platformCase.update({
          where: { id },
          data: {
            category: input.category,
            severity: input.severity,
            version: { increment: 1 },
          },
        });
        await this.event(tx, id, actor, 'CLASSIFIED', 'INTERNAL', input.note, {
          from: { category: row.category, severity: row.severity },
          to: { category: input.category, severity: input.severity },
        });
        return {
          reason: input.note,
          details: { severity: input.severity },
          org: row.ownerOrganizationId,
        };
      },
    );
  }

  assign(actor: CommandActor, id: string, input: AssignCaseDto) {
    return this.mutate(
      actor,
      id,
      input.version,
      'CASE_ASSIGNED',
      async (tx, row) => {
        await this.activeOwner(tx, input.ownerOrganizationId);
        const due = futureDate(input.responseDueAt);
        await tx.platformCase.update({
          where: { id },
          data: {
            ownerOrganizationId: input.ownerOrganizationId,
            responseDueAt: due ?? null,
            // A reassignment starts the acknowledgement over.
            status: 'ASSIGNED',
            acknowledgedAt: null,
            respondedAt: null,
            version: { increment: 1 },
          },
        });
        await this.event(tx, id, actor, 'ASSIGNED', 'SHARED', input.note, {
          previousOwner: row.ownerOrganizationId,
          ownerOrganizationId: input.ownerOrganizationId,
          responseDueAt: due?.toISOString() ?? null,
        });
        return {
          reason: input.note,
          details: { ownerOrganizationId: input.ownerOrganizationId },
          org: input.ownerOrganizationId,
        };
      },
    );
  }

  linkLot(actor: CommandActor, id: string, input: LinkCaseLotDto) {
    return this.mutate(
      actor,
      id,
      input.version,
      'CASE_LOT_LINKED',
      async (tx, row) => {
        const lot = await this.existingLot(tx, input.lotId);
        await tx.platformCase.update({
          where: { id },
          data: { lotId: lot.id, version: { increment: 1 } },
        });
        await this.event(tx, id, actor, 'LOT_LINKED', 'INTERNAL', input.note, {
          previousLotId: row.lotId,
          lotId: lot.id,
        });
        return {
          reason: input.note,
          details: { lotId: lot.id },
          org: row.ownerOrganizationId,
        };
      },
    );
  }

  note(actor: CommandActor, id: string, input: CaseNoteDto) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      const row = await this.lockedCase(tx, id);
      const visibility = input.visibility ?? 'INTERNAL';
      if (visibility === 'SHARED' && !row.ownerOrganizationId)
        throw new UnprocessableEntityException(
          'Chỉ chia sẻ ghi chú khi hồ sơ đã giao cho tổ chức',
        );
      await this.event(tx, id, actor, 'NOTE', visibility, input.note);
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: 'CASE_NOTE_ADDED',
        subjectType: 'PLATFORM_CASE',
        subjectId: id,
        organizationId: row.ownerOrganizationId,
        details: { visibility },
      });
      return this.reload(tx, id);
    });
  }

  escalate(actor: CommandActor, id: string, input: EscalateCaseDto) {
    return this.mutate(
      actor,
      id,
      input.version,
      'CASE_ESCALATED',
      async (tx, row) => {
        await tx.platformCase.update({
          where: { id },
          data: {
            status: 'ESCALATED',
            escalatedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.event(
          tx,
          id,
          actor,
          'ESCALATED',
          row.ownerOrganizationId ? 'SHARED' : 'INTERNAL',
          input.note,
          { previousStatus: row.status, overdue: overdue(row) },
        );
        return {
          reason: input.note,
          details: { previousStatus: row.status },
          org: row.ownerOrganizationId,
        };
      },
    );
  }

  close(actor: CommandActor, id: string, input: CloseCaseDto) {
    return this.mutate(
      actor,
      id,
      input.version,
      'CASE_CLOSED',
      async (tx, row) => {
        await tx.platformCase.update({
          where: { id },
          data: {
            status: 'CLOSED',
            closedAt: new Date(),
            closeReason: input.reason,
            version: { increment: 1 },
          },
        });
        await this.event(
          tx,
          id,
          actor,
          'CLOSED',
          row.ownerOrganizationId ? 'SHARED' : 'INTERNAL',
          input.reason,
          { previousStatus: row.status },
        );
        return {
          reason: input.reason,
          details: { previousStatus: row.status },
          org: row.ownerOrganizationId,
        };
      },
    );
  }

  /** Shared skeleton of an administrator transition: lock, version check, the
   * change, a platform audit entry in the same transaction. */
  private mutate(
    actor: CommandActor,
    id: string,
    version: number,
    auditAction: string,
    work: (
      tx: Prisma.TransactionClient,
      row: Awaited<ReturnType<PlatformCasesService['lockedCase']>>,
    ) => Promise<{
      reason: string;
      details: Record<string, unknown>;
      org: string | null;
    }>,
  ) {
    return commandTransaction(this.prisma, async (tx) => {
      await lockPlatformAudit(tx);
      const row = await this.lockedCase(tx, id, version);
      const audit = await work(tx, row);
      await appendPlatformAudit(tx, {
        actor: { sub: actor.sub, role: actor.role },
        action: auditAction,
        subjectType: 'PLATFORM_CASE',
        subjectId: id,
        organizationId: audit.org,
        reason: audit.reason,
        details: audit.details,
      });
      return this.reload(tx, id);
    });
  }

  // ---------------------------------------------------------- enterprise side

  private organizationOf(actor: CommandActor) {
    if (!actor.organizationId || PLATFORM_ROLES.includes(actor.role))
      throw new ForbiddenException('Chỉ doanh nghiệp được xem yêu cầu này');
    return actor.organizationId;
  }

  /** The organization sees only what was addressed to it: its own cases and the
   * SHARED part of their history. Internal notes and the source stay private. */
  private enterpriseView(
    row: CaseRow,
    events: { id: string; action: string; note: string; createdAt: Date }[],
    canRespond = false,
  ) {
    return {
      id: row.id,
      allowedActions: canRespond ? [...(['ASSIGNED','ESCALATED'].includes(row.status) ? ['ACKNOWLEDGE'] : []), ...(['ASSIGNED','ACKNOWLEDGED','ESCALATED'].includes(row.status) ? ['RESPOND'] : [])] : [],
      caseNumber: Number(row.caseNumber),
      title: row.title,
      description: row.description,
      category: row.category,
      severity: row.severity,
      status: row.status,
      lot: row.lot,
      responseDueAt: row.responseDueAt,
      overdue: overdue(row),
      version: row.version,
      createdAt: row.createdAt,
      events,
    };
  }

  async listForOrganization(actor: CommandActor) {
    const organizationId = this.organizationOf(actor);
    await enterpriseAuthority(this.prisma, actor, 'cases.read');
    let canRespond = false;
    try { await enterpriseAuthority(this.prisma, actor, 'cases.respond'); canRespond = true; } catch (error) { if (!(error instanceof ForbiddenException)) throw error; }
    const rows = await this.prisma.platformCase.findMany({
      where: { ownerOrganizationId: organizationId },
      include: {
        ...CASE_INCLUDE,
        events: {
          where: { visibility: 'SHARED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, action: true, note: true, createdAt: true },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map((row) => this.enterpriseView(row, row.events, canRespond));
  }

  private async ownedCase(
    tx: Prisma.TransactionClient,
    actor: CommandActor,
    id: string,
    version: number,
  ) {
    const organizationId = this.organizationOf(actor);
    const row = await this.lockedCase(tx, id, undefined);
    // Not found and not yours look the same.
    if (row.ownerOrganizationId !== organizationId)
      throw new NotFoundException('Không tìm thấy hồ sơ');
    if (row.version !== version)
      throw new ConflictException('Hồ sơ đã thay đổi; tải lại trạng thái');
    return { row, organizationId };
  }

  acknowledge(actor: CommandActor, id: string, input: EnterpriseCaseAckDto) {
    return commandTransaction(this.prisma, async (tx) => {
      const { row, organizationId } = await this.ownedCase(
        tx,
        actor,
        id,
        input.version,
      );
      if (!['ASSIGNED', 'ESCALATED'].includes(row.status))
        throw new ConflictException('Hồ sơ không ở trạng thái chờ xác nhận');
      await tx.platformCase.update({
        where: { id },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.event(
        tx,
        id,
        { sub: actor.sub, organizationId },
        'ACKNOWLEDGED',
        'SHARED',
        input.note ?? 'Doanh nghiệp đã nhận hồ sơ',
      );
      return this.forOrganization(tx, id);
    });
  }

  respond(actor: CommandActor, id: string, input: EnterpriseCaseResponseDto) {
    return commandTransaction(this.prisma, async (tx) => {
      const { row, organizationId } = await this.ownedCase(
        tx,
        actor,
        id,
        input.version,
      );
      if (!['ASSIGNED', 'ACKNOWLEDGED', 'ESCALATED'].includes(row.status))
        throw new ConflictException('Hồ sơ không ở trạng thái chờ phản hồi');
      await tx.platformCase.update({
        where: { id },
        data: {
          status: 'RESPONDED',
          respondedAt: new Date(),
          version: { increment: 1 },
        },
      });
      await this.event(
        tx,
        id,
        { sub: actor.sub, organizationId },
        'RESPONDED',
        'SHARED',
        input.note,
      );
      return this.forOrganization(tx, id);
    });
  }

  private async forOrganization(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.platformCase.findUniqueOrThrow({
      where: { id },
      include: {
        ...CASE_INCLUDE,
        events: {
          where: { visibility: 'SHARED' },
          orderBy: { createdAt: 'asc' },
          select: { id: true, action: true, note: true, createdAt: true },
        },
      },
    });
    return this.enterpriseView(row, row.events);
  }
}
