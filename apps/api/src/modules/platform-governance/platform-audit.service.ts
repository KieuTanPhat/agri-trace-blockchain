import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuditQueryDto } from './dto.js';
import { verifyPlatformAuditChain } from './platform-audit.js';

export const EXPORT_ROW_LIMIT = 5000;

const WHO = { select: { id: true, fullName: true, email: true } } as const;

function parseDate(value: string | undefined, label: string) {
  if (value === undefined) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new UnprocessableEntityException(`Thời điểm ${label} không hợp lệ`);
  return date;
}

function encodeCursor(sequence: bigint) {
  return Buffer.from(sequence.toString(), 'utf8').toString('base64url');
}
function decodeCursor(cursor: string) {
  try {
    const text = Buffer.from(cursor, 'base64url').toString('utf8');
    if (!/^\d{1,18}$/u.test(text)) throw new Error('cursor');
    return BigInt(text);
  } catch {
    throw new UnprocessableEntityException('Cursor không hợp lệ');
  }
}

/** CSV cells that spreadsheets could evaluate as formulas are neutralized. */
export function csvCell(value: unknown): string {
  let text =
    value === null || value === undefined
      ? ''
      : typeof value === 'string'
        ? value
        : JSON.stringify(value);
  if (/^[=+\-@\t\r]/u.test(text)) text = `'${text}`;
  return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

@Injectable()
export class PlatformAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private where(query: AuditQueryDto): Prisma.PlatformAuditWhereInput {
    const from = parseDate(query.from, 'bắt đầu');
    const to = parseDate(query.to, 'kết thúc');
    return {
      ...(from || to ? { occurredAt: { gte: from, lte: to } } : {}),
      ...(query.actorUserId ? { actorUserId: query.actorUserId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
    };
  }

  private async rows(query: AuditQueryDto, take: number, cursor?: bigint) {
    return this.prisma.platformAudit.findMany({
      where: {
        ...this.where(query),
        ...(cursor !== undefined ? { sequence: { lt: cursor } } : {}),
      },
      include: {
        actor: WHO,
        organization: { select: { id: true, name: true } },
      },
      orderBy: { sequence: 'desc' },
      take,
    });
  }

  private present(
    row: Awaited<ReturnType<PlatformAuditService['rows']>>[number],
  ) {
    return {
      id: row.id,
      sequence: row.sequence.toString(),
      occurredAt: row.occurredAt,
      actor: row.actor,
      actorRole: row.actorRole,
      action: row.action,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      organization: row.organization,
      reason: row.reason,
      requestId: row.requestId,
      idempotencyKey: row.idempotencyKey,
      outcome: row.outcome,
      details: row.details,
      prevHash: row.prevHash,
      entryHash: row.entryHash,
    };
  }

  async list(query: AuditQueryDto) {
    const limit = query.limit ?? 50;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.rows(query, limit + 1, cursor);
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.present(row)),
      nextCursor:
        rows.length > limit
          ? encodeCursor(page[page.length - 1].sequence)
          : null,
    };
  }

  async exportCsv(query: AuditQueryDto) {
    const rows = await this.rows(query, EXPORT_ROW_LIMIT + 1);
    const truncated = rows.length > EXPORT_ROW_LIMIT;
    const page = rows
      .slice(0, EXPORT_ROW_LIMIT)
      .map((row) => this.present(row));
    const header = [
      'sequence',
      'occurredAt',
      'actorEmail',
      'actorRole',
      'action',
      'subjectType',
      'subjectId',
      'organization',
      'outcome',
      'reason',
      'requestId',
      'idempotencyKey',
      'details',
      'entryHash',
    ];
    const lines = [header.join(',')];
    for (const row of page)
      lines.push(
        [
          row.sequence,
          row.occurredAt.toISOString(),
          row.actor?.email ?? 'SYSTEM',
          row.actorRole,
          row.action,
          row.subjectType,
          row.subjectId,
          row.organization?.name ?? '',
          row.outcome,
          row.reason,
          row.requestId,
          row.idempotencyKey,
          row.details,
          row.entryHash,
        ]
          .map(csvCell)
          .join(','),
      );
    return {
      filename: `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`,
      rowCount: page.length,
      truncated,
      limit: EXPORT_ROW_LIMIT,
      csv: lines.join('\r\n') + '\r\n',
    };
  }

  verify() {
    return verifyPlatformAuditChain(this.prisma);
  }

  /** Distinct actions for the filter control. */
  async actions() {
    const rows = await this.prisma.platformAudit.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 200,
    });
    return rows.map((row) => row.action);
  }
}
