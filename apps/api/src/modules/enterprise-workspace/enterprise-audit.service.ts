import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { isUUID } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { enterpriseAuthority } from './enterprise-policy.js';
import type {
  EnterpriseAuditQueryDto,
  EnterpriseAuditEntryDto,
} from './enterprise-audit.dto.js';

const ACCOUNT_ACTIONS = [
  'STAFF_PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'USER_LOGIN_LOCKED',
  'USER_SESSIONS_REVOKED_SELF',
];
type Cursor = { command: string | null; account: string | null };
const invalidCursor = () =>
  new BadRequestException(
    'Trang lịch sử không còn hợp lệ. Vui lòng tải lại từ đầu.',
  );

@Injectable()
export class EnterpriseAuditService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}
  private signature(body: string, scope: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET'))
      .update('agritrace:enterprise-audit:v1\0' + scope + '\0' + body)
      .digest('hex');
  }
  private decode(token: string | undefined, scope: string): Cursor {
    if (!token) return { command: null, account: null };
    const match = /^([A-Za-z0-9_-]{1,850})\.([a-f0-9]{64})$/.exec(token);
    if (
      !match ||
      !timingSafeEqual(
        Buffer.from(match[2], 'hex'),
        Buffer.from(this.signature(match[1], scope), 'hex'),
      )
    )
      throw invalidCursor();
    try {
      const value = JSON.parse(
        Buffer.from(match[1], 'base64url').toString('utf8'),
      ) as Cursor;
      if (
        !value ||
        !['command', 'account'].every(
          (key) =>
            value[key as keyof Cursor] === null ||
            (typeof value[key as keyof Cursor] === 'string' &&
              isUUID(value[key as keyof Cursor])),
        )
      )
        throw invalidCursor();
      return value;
    } catch {
      throw invalidCursor();
    }
  }
  async list(actor: CommandActor, query: EnterpriseAuditQueryDto) {
    const from = query.from ? new Date(query.from) : undefined,
      to = query.to ? new Date(query.to) : undefined;
    if (
      (from && Number.isNaN(from.getTime())) ||
      (to && Number.isNaN(to.getTime())) ||
      (from && to && from > to)
    )
      throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const limit = query.limit ?? 25;
    const q = query.q?.trim() ?? '';
    const scope = JSON.stringify([
      actor.sub,
      actor.organizationId,
      q,
      query.employeeId ?? null,
      query.action ?? null,
      query.outcome ?? null,
      query.from ?? null,
      query.to ?? null,
    ]);
    // Read authorization and records in one snapshot; staff changes use the same enterprise lock.
    return this.db.$transaction(
      async (tx) => {
        const auth = await enterpriseAuthority(
          tx,
          actor,
          'members.manage',
          undefined,
          undefined,
          true,
        );
        const organizationId = auth.user.organizationId!;
        const cursor = this.decode(query.cursor, scope);
        const employees = await tx.user.findMany({
          where: {
            organizationId,
            role: { code: 'ENTERPRISE_STAFF' },
            ...(query.employeeId ? { id: query.employeeId } : {}),
            ...(q
              ? {
                  OR: [
                    { fullName: { contains: q, mode: 'insensitive' as const } },
                    { email: { contains: q, mode: 'insensitive' as const } },
                  ],
                }
              : {}),
          },
          select: { id: true, fullName: true, email: true },
        });
        const employeeIds = employees.map((e) => e.id);
        const people = new Map(employees.map((e) => [e.id, e]));
        const time = from || to ? { gte: from, lte: to } : undefined;
        const commandWhere: Prisma.CommandCommitWhereInput = {
          requesterId: { in: employeeIds },
          actorScope: { path: ['organizationId'], equals: organizationId },
          ...(time ? { committedAt: time } : {}),
          ...(query.action ? { operation: query.action } : {}),
        };
        const accountWhere: Prisma.PlatformAuditWhereInput = {
          organizationId,
          actorUserId: { in: employeeIds },
          actorRole: 'ENTERPRISE_STAFF',
          action: {
            in: ACCOUNT_ACTIONS,
            ...(query.action ? { equals: query.action } : {}),
          },
          ...(time ? { occurredAt: time } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
        };
        // Validate bookmarks against this tenant/filter before Prisma's cursor lookup.
        if (
          cursor.command &&
          !(await tx.commandCommit.findFirst({
            where: { AND: [commandWhere, { id: cursor.command }] },
            select: { id: true },
          }))
        )
          throw invalidCursor();
        if (
          cursor.account &&
          !(await tx.platformAudit.findFirst({
            where: { AND: [accountWhere, { id: cursor.account }] },
            select: { id: true },
          }))
        )
          throw invalidCursor();
        const commands =
          query.outcome && query.outcome !== 'SUCCESS'
            ? []
            : await tx.commandCommit.findMany({
                where: commandWhere,
                select: {
                  id: true,
                  requesterId: true,
                  operation: true,
                  committedAt: true,
                },
                orderBy: [{ committedAt: 'desc' }, { id: 'desc' }],
                take: limit + 1,
                ...(cursor.command
                  ? { cursor: { id: cursor.command }, skip: 1 }
                  : {}),
              });
        const accounts = await tx.platformAudit.findMany({
          where: accountWhere,
          select: {
            id: true,
            actorUserId: true,
            action: true,
            occurredAt: true,
            outcome: true,
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(cursor.account
            ? { cursor: { id: cursor.account }, skip: 1 }
            : {}),
        });
        // The stable merge preserves each source's database order, including sub-millisecond ties.
        const rows: Array<EnterpriseAuditEntryDto & { bookmark: string }> =
          commands.map((r) => ({
            id: 'activity:' + r.id,
            bookmark: r.id,
            occurredAt: r.committedAt,
            employee: people.get(r.requesterId)!,
            action: r.operation,
            outcome: 'SUCCESS',
            category: 'ACTIVITY',
          }));
        rows.push(
          ...accounts.map((r) => ({
            id: 'account:' + r.id,
            bookmark: r.id,
            occurredAt: r.occurredAt,
            employee: people.get(r.actorUserId!)!,
            action: r.action,
            outcome: r.outcome,
            category: 'ACCOUNT',
          })),
        );
        rows.sort(
          (a, b) =>
            b.occurredAt.getTime() - a.occurredAt.getTime() ||
            b.category.localeCompare(a.category),
        );
        const page = rows.slice(0, limit);
        const next = { ...cursor };
        for (const row of page)
          next[row.category === 'ACTIVITY' ? 'command' : 'account'] =
            row.bookmark;
        const body = Buffer.from(JSON.stringify(next)).toString('base64url');
        return {
          items: page.map(({ bookmark, ...row }) => {
            void bookmark;
            return row;
          }),
          nextCursor:
            rows.length > limit
              ? body + '.' + this.signature(body, scope)
              : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
