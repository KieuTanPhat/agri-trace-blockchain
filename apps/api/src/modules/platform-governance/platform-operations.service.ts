import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { OperationsQueryDto } from './dto.js';

/** A binding is "stale" when the Worker has not checked it recently. */
export const BINDING_STALE_MS = 10 * 60_000;
/** A due outbox/mail row is "overdue" when it waited this long past its slot. */
export const OVERDUE_MS = 5 * 60_000;
const UNFINISHED_OUTBOX = ['PENDING', 'PROCESSING', 'RETRY'] as const;
const MAX_ERROR_LENGTH = 300;
const DAY_MS = 86_400_000;

/** Warning bands for certificate expiry: expired, then 7/14/30 days ahead. */
export function certificateBucket(msLeft: number) {
  if (msLeft <= 0) return 'EXPIRED';
  if (msLeft <= 7 * DAY_MS) return '7_DAYS';
  if (msLeft <= 14 * DAY_MS) return '14_DAYS';
  return '30_DAYS';
}
const ALLOWED_STATUS = {
  outbox: ['PENDING', 'PROCESSING', 'RETRY', 'COMPLETED', 'DEAD_LETTER'],
  jobs: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'],
  mail: ['PENDING', 'SENT', 'CANCELLED', 'RETRYING'],
} as const;

function assertStatus(
  value: string | undefined,
  allowed: readonly string[],
): void {
  if (value !== undefined && !allowed.includes(value))
    throw new UnprocessableEntityException('Trạng thái lọc không hợp lệ');
}

/** Free text from workers can embed hostnames or fragments of payloads. The
 * dashboard shows only a short, single-line prefix and never any mail body. */
function brief(value: string | null) {
  return value ? value.replace(/\s+/gu, ' ').slice(0, MAX_ERROR_LENGTH) : null;
}
const ageSeconds = (from: Date | null, now: number) =>
  from ? Math.max(0, Math.floor((now - from.getTime()) / 1000)) : null;

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

/** Which filters a section can honour. The UI shows this so an unfiltered
 * section is never mistaken for an empty filtered one. */
type Scope = ('chain' | 'organization')[];

/** Read-only operational picture of the platform. Counts and metadata only:
 * no mail recipient/subject/body, no payloads, no keys. There is deliberately
 * no operation here that retries, edits or deletes anything. */
@Injectable()
export class PlatformOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async adminSummary() {
    const now = new Date();
    const awaitingReport = {
      kind: 'BREACH',
      reportedAt: null,
      reporting: { not: 'NOT_REQUIRED' },
    };
    const [
      pendingApprovals,
      openCases,
      overdueCases,
      privacyRequests,
      breachReportsDue,
      breachReportsOverdue,
      lockedAccounts,
    ] = await this.prisma.$transaction(
      [
        this.prisma.platformApproval.count({
          where: { status: 'PENDING', expiresAt: { gt: now } },
        }),
        this.prisma.platformCase.count({
          where: { status: { not: 'CLOSED' } },
        }),
        this.prisma.platformCase.count({
          where: {
            status: { in: ['ASSIGNED', 'ACKNOWLEDGED', 'ESCALATED'] },
            responseDueAt: { lt: now },
          },
        }),
        this.prisma.platformPrivacyTicket.count({
          where: { kind: 'REQUEST', status: { in: ['OPEN', 'IN_REVIEW'] } },
        }),
        this.prisma.platformPrivacyTicket.count({ where: awaitingReport }),
        this.prisma.platformPrivacyTicket.count({
          where: { ...awaitingReport, deadlineAt: { lt: now } },
        }),
        this.prisma.user.count({ where: { lockedUntil: { gt: now } } }),
      ],
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      generatedAt: now.toISOString(),
      pendingApprovals,
      openCases,
      overdueCases,
      privacyRequests,
      breachReportsDue,
      breachReportsOverdue,
      lockedAccounts,
    };
  }

  private filters(query: OperationsQueryDto) {
    const { chainId, organizationId } = query;
    const event: Prisma.TraceEventWhereInput = {
      ...(organizationId ? { actorOrganizationId: organizationId } : {}),
      ...(chainId ? { chainContext: { chainId } } : {}),
    };
    const scoped = !!chainId || !!organizationId;
    return {
      outbox: (scoped
        ? { traceEvent: event }
        : {}) as Prisma.BlockchainOutboxWhereInput,
      holds: {
        resolvedAt: null,
        ...(chainId ? { binding: { chainId } } : {}),
        ...(organizationId
          ? { event: { actorOrganizationId: organizationId } }
          : {}),
      } as Prisma.DeliveryHoldWhereInput,
      jobs: {
        ...(chainId ? { binding: { chainId } } : {}),
        ...(organizationId
          ? { event: { actorOrganizationId: organizationId } }
          : {}),
      } as Prisma.LedgerControlJobWhereInput,
      health: (chainId
        ? { binding: { chainId } }
        : {}) as Prisma.BindingWorkerHealthWhereInput,
      mail: (organizationId
        ? { enrollment: { organizationId } }
        : {}) as Prisma.EnterpriseMailWhereInput,
      sessions: {
        revokedAt: null,
        expiresAt: { gt: new Date() },
        ...(organizationId ? { user: { organizationId } } : {}),
      } as Prisma.RefreshSessionWhereInput,
      users: (organizationId
        ? { organizationId }
        : {}) as Prisma.UserWhereInput,
    };
  }

  async summary(query: OperationsQueryDto) {
    const now = Date.now();
    const where = this.filters(query);
    const [
      outboxGroups,
      outboxOldest,
      outboxOverdue,
      holdCount,
      holdOldest,
      jobGroups,
      jobOldest,
      healthRows,
      mailGroups,
      mailOldest,
      mailOverdue,
      mailRetrying,
      activeSessions,
      lockedAccounts,
      disabledAccounts,
    ] = await Promise.all([
      this.prisma.blockchainOutbox.groupBy({
        by: ['status'],
        where: where.outbox,
        _count: { _all: true },
      }),
      this.prisma.blockchainOutbox.findFirst({
        where: { ...where.outbox, status: { in: [...UNFINISHED_OUTBOX] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.blockchainOutbox.count({
        where: {
          ...where.outbox,
          status: { in: ['PENDING', 'RETRY'] },
          nextAttemptAt: { lt: new Date(now - OVERDUE_MS) },
        },
      }),
      this.prisma.deliveryHold.count({ where: where.holds }),
      this.prisma.deliveryHold.findFirst({
        where: where.holds,
        orderBy: { openedAt: 'asc' },
        select: { openedAt: true },
      }),
      this.prisma.ledgerControlJob.groupBy({
        by: ['status'],
        where: where.jobs,
        _count: { _all: true },
      }),
      this.prisma.ledgerControlJob.findFirst({
        where: { ...where.jobs, status: { in: ['PENDING', 'PROCESSING'] } },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.bindingWorkerHealth.findMany({
        where: where.health,
        select: {
          lastCheckedAt: true,
          lastHealthyAt: true,
          lastErrorCode: true,
        },
      }),
      this.prisma.enterpriseMail.groupBy({
        by: ['status'],
        where: where.mail,
        _count: { _all: true },
      }),
      this.prisma.enterpriseMail.findFirst({
        where: { ...where.mail, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
      this.prisma.enterpriseMail.count({
        where: {
          ...where.mail,
          status: 'PENDING',
          nextAttemptAt: { lt: new Date(now - OVERDUE_MS) },
        },
      }),
      // The worker leases a row (attempts+1) and leaves it PENDING with a later
      // slot when sending fails, so two or more attempts means a failed try.
      this.prisma.enterpriseMail.count({
        where: { ...where.mail, status: 'PENDING', attempts: { gte: 2 } },
      }),
      this.prisma.refreshSession.count({ where: where.sessions }),
      this.prisma.user.count({
        where: { ...where.users, lockedUntil: { gt: new Date() } },
      }),
      this.prisma.user.count({
        where: { ...where.users, accountStatus: { not: 'ACTIVE' } },
      }),
    ]);
    const counts = <T extends { status: string; _count: { _all: number } }>(
      rows: T[],
      keys: string[],
    ) =>
      Object.fromEntries(
        keys.map((key) => [
          key,
          rows.find((row) => row.status === key)?._count._all ?? 0,
        ]),
      );
    const unhealthy = healthRows.filter(
      (row) =>
        row.lastErrorCode !== null ||
        row.lastHealthyAt === null ||
        now - row.lastCheckedAt.getTime() > BINDING_STALE_MS,
    ).length;
    const chainOrg: Scope = ['chain', 'organization'];
    return {
      generatedAt: new Date(now).toISOString(),
      filters: {
        chainId: query.chainId ?? null,
        organizationId: query.organizationId ?? null,
      },
      outbox: {
        scopedBy: chainOrg,
        counts: counts(outboxGroups, [
          'PENDING',
          'PROCESSING',
          'RETRY',
          'COMPLETED',
          'DEAD_LETTER',
        ]),
        oldestUnfinishedAgeSeconds: ageSeconds(
          outboxOldest?.createdAt ?? null,
          now,
        ),
        overdue: outboxOverdue,
      },
      holds: {
        scopedBy: chainOrg,
        open: holdCount,
        oldestOpenAgeSeconds: ageSeconds(holdOldest?.openedAt ?? null, now),
      },
      ledgerJobs: {
        scopedBy: chainOrg,
        counts: counts(jobGroups, [
          'PENDING',
          'PROCESSING',
          'COMPLETED',
          'FAILED',
        ]),
        oldestUnfinishedAgeSeconds: ageSeconds(
          jobOldest?.createdAt ?? null,
          now,
        ),
      },
      bindingHealth: {
        scopedBy: ['chain'] as Scope,
        total: healthRows.length,
        unhealthy,
      },
      mail: {
        scopedBy: ['organization'] as Scope,
        counts: counts(mailGroups, ['PENDING', 'SENT', 'CANCELLED']),
        retrying: mailRetrying,
        oldestPendingAgeSeconds: ageSeconds(mailOldest?.createdAt ?? null, now),
        overdue: mailOverdue,
      },
      accounts: {
        scopedBy: ['organization'] as Scope,
        activeSessions,
        lockedAccounts,
        disabledAccounts,
      },
    };
  }

  private page<T extends { id: string }>(rows: T[], limit: number) {
    const items = rows.slice(0, limit);
    return {
      items,
      nextCursor:
        rows.length > limit ? encodeCursor(items[items.length - 1].id) : null,
    };
  }

  async outbox(query: OperationsQueryDto) {
    const limit = query.limit ?? 25;
    const now = Date.now();
    const status = query.status;
    assertStatus(status, ALLOWED_STATUS.outbox);
    const rows = await this.prisma.blockchainOutbox.findMany({
      where: {
        ...this.filters(query).outbox,
        status: status
          ? (status as 'PENDING')
          : { in: [...UNFINISHED_OUTBOX, 'DEAD_LETTER'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: decodeCursor(query.cursor) } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      select: {
        id: true,
        eventId: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        leaseExpiresAt: true,
        lastError: true,
        createdAt: true,
        traceEvent: {
          select: {
            eventType: true,
            organization: { select: { id: true, name: true } },
            chainContext: {
              select: { chainId: true, chain: { select: { name: true } } },
            },
          },
        },
      },
    });
    const page = this.page(rows, limit);
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        eventId: row.eventId,
        eventType: row.traceEvent.eventType,
        status: row.status,
        attemptCount: row.attemptCount,
        nextAttemptAt: row.nextAttemptAt,
        leased: !!row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now,
        lastError: brief(row.lastError),
        createdAt: row.createdAt,
        ageSeconds: ageSeconds(row.createdAt, now) ?? 0,
        organization: row.traceEvent.organization,
        chainId: row.traceEvent.chainContext?.chainId ?? null,
        chainName: row.traceEvent.chainContext?.chain.name ?? null,
      })),
    };
  }

  async holds(query: OperationsQueryDto) {
    const limit = query.limit ?? 25;
    const now = Date.now();
    const rows = await this.prisma.deliveryHold.findMany({
      where: this.filters(query).holds,
      orderBy: [{ openedAt: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: decodeCursor(query.cursor) } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      select: {
        id: true,
        scope: true,
        reason: true,
        openedAt: true,
        eventId: true,
        binding: { select: { chainId: true } },
      },
    });
    const page = this.page(rows, limit);
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        scope: row.scope,
        reason: brief(row.reason) ?? '',
        openedAt: row.openedAt,
        ageSeconds: ageSeconds(row.openedAt, now) ?? 0,
        eventId: row.eventId,
        chainId: row.binding.chainId,
      })),
    };
  }

  async ledgerJobs(query: OperationsQueryDto) {
    const limit = query.limit ?? 25;
    const now = Date.now();
    assertStatus(query.status, ALLOWED_STATUS.jobs);
    const rows = await this.prisma.ledgerControlJob.findMany({
      where: {
        ...this.filters(query).jobs,
        status: query.status
          ? (query.status as 'FAILED')
          : { in: ['PENDING', 'PROCESSING', 'FAILED'] },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: decodeCursor(query.cursor) } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      select: {
        id: true,
        operation: true,
        status: true,
        attemptCount: true,
        nextAttemptAt: true,
        lastError: true,
        createdAt: true,
        binding: { select: { chainId: true } },
      },
    });
    const page = this.page(rows, limit);
    return {
      ...page,
      items: page.items.map((row) => ({
        id: row.id,
        operation: row.operation,
        status: row.status,
        attemptCount: row.attemptCount,
        nextAttemptAt: row.nextAttemptAt,
        lastError: brief(row.lastError),
        createdAt: row.createdAt,
        ageSeconds: ageSeconds(row.createdAt, now) ?? 0,
        chainId: row.binding.chainId,
      })),
    };
  }

  async bindingHealth(query: OperationsQueryDto) {
    const limit = query.limit ?? 25;
    const now = Date.now();
    const rows = await this.prisma.bindingWorkerHealth.findMany({
      where: this.filters(query).health,
      orderBy: [{ lastCheckedAt: 'asc' }, { bindingDigest: 'asc' }],
      take: limit,
      select: {
        bindingDigest: true,
        lastCheckedAt: true,
        lastHealthyAt: true,
        lastErrorCode: true,
        certificateExpiresAt: true,
        binding: { select: { chainId: true } },
      },
    });
    return {
      items: rows.map((row) => ({
        // Digest prefix only: enough to tell bindings apart.
        bindingDigest: row.bindingDigest.slice(0, 16),
        chainId: row.binding.chainId,
        lastCheckedAt: row.lastCheckedAt,
        lastHealthyAt: row.lastHealthyAt,
        lastErrorCode: row.lastErrorCode,
        certificateExpiresAt: row.certificateExpiresAt,
        stale: now - row.lastCheckedAt.getTime() > BINDING_STALE_MS,
      })),
      nextCursor: null,
    };
  }

  /** Certificate expiry comes only from what the Worker observed on each
   * binding (BindingWorkerHealth.certificateExpiresAt). Approved credential
   * fingerprints and Ed25519 signing keys carry no expiry in the schema, so
   * they appear here only as revocation facts. Read-only. */
  async credentials(query: OperationsQueryDto) {
    const now = Date.now();
    const bindingFilter = query.chainId
      ? { binding: { chainId: query.chainId } }
      : {};
    const horizon = new Date(now + 30 * DAY_MS);
    const [
      certificateRows,
      noCertificate,
      credentialGroups,
      revokedCredentials,
      keyGroups,
      revokedKeys,
    ] = await Promise.all([
      this.prisma.bindingWorkerHealth.findMany({
        where: { ...bindingFilter, certificateExpiresAt: { lte: horizon } },
        orderBy: { certificateExpiresAt: 'asc' },
        take: 100,
        select: {
          bindingDigest: true,
          certificateExpiresAt: true,
          lastCheckedAt: true,
          binding: { select: { chainId: true } },
        },
      }),
      this.prisma.bindingWorkerHealth.count({
        where: { ...bindingFilter, certificateExpiresAt: null },
      }),
      this.prisma.fabricCredentialRevision.groupBy({
        by: ['status'],
        where: bindingFilter,
        _count: { _all: true },
      }),
      this.prisma.fabricCredentialRevision.findMany({
        where: { ...bindingFilter, revokedAt: { not: null } },
        orderBy: { revokedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          bindingDigest: true,
          certFingerprint: true,
          revokedAt: true,
          binding: { select: { chainId: true } },
        },
      }),
      this.prisma.signingKey.groupBy({
        by: ['status'],
        where: {
          ...(query.chainId ? { chainId: query.chainId } : {}),
          ...(query.organizationId
            ? { organizationId: query.organizationId }
            : {}),
        },
        _count: { _all: true },
      }),
      this.prisma.signingKey.findMany({
        where: {
          status: 'REVOKED',
          ...(query.chainId ? { chainId: query.chainId } : {}),
          ...(query.organizationId
            ? { organizationId: query.organizationId }
            : {}),
        },
        orderBy: { revokedAt: 'desc' },
        take: 50,
        select: {
          keyRef: true,
          label: true,
          chainId: true,
          revokedAt: true,
          revokeReason: true,
          organization: { select: { id: true, name: true } },
        },
      }),
    ]);
    const certificates = certificateRows.map((row) => {
      const expiresAt = row.certificateExpiresAt as Date;
      const days = Math.floor((expiresAt.getTime() - now) / DAY_MS);
      return {
        bindingDigest: row.bindingDigest.slice(0, 16),
        chainId: row.binding.chainId,
        certificateExpiresAt: expiresAt,
        daysLeft: days,
        bucket: certificateBucket(expiresAt.getTime() - now),
        lastCheckedAt: row.lastCheckedAt,
      };
    });
    const bucketCount = (bucket: string) =>
      certificates.filter((row) => row.bucket === bucket).length;
    const keyCount = (status: string) =>
      keyGroups.find((row) => row.status === status)?._count._all ?? 0;
    const credentialCount = (status: string) =>
      credentialGroups.find((row) => row.status === status)?._count._all ?? 0;
    return {
      generatedAt: new Date(now).toISOString(),
      certificates: {
        scopedBy: ['chain'] as Scope,
        expired: bucketCount('EXPIRED'),
        within7Days: bucketCount('7_DAYS'),
        within14Days: bucketCount('14_DAYS'),
        within30Days: bucketCount('30_DAYS'),
        unknownExpiry: noCertificate,
        items: certificates,
      },
      credentials: {
        scopedBy: ['chain'] as Scope,
        approved: credentialCount('APPROVED'),
        revoked: revokedCredentials.length,
        items: revokedCredentials.map((row) => ({
          id: row.id,
          bindingDigest: row.bindingDigest.slice(0, 16),
          // A fingerprint prefix identifies the certificate without being it.
          fingerprint: row.certFingerprint.slice(0, 16),
          chainId: row.binding.chainId,
          revokedAt: row.revokedAt as Date,
        })),
      },
      signingKeys: {
        scopedBy: ['chain', 'organization'] as Scope,
        expiryTracked: false,
        counts: {
          PENDING_LEDGER: keyCount('PENDING_LEDGER'),
          ACTIVE: keyCount('ACTIVE'),
          REVOKED: keyCount('REVOKED'),
        },
        items: revokedKeys.map((row) => ({
          keyRef: row.keyRef,
          label: row.label,
          chainId: row.chainId,
          organization: row.organization,
          revokedAt: row.revokedAt,
          revokeReason: brief(row.revokeReason),
        })),
      },
    };
  }

  async mail(query: OperationsQueryDto) {
    const limit = query.limit ?? 25;
    const now = Date.now();
    assertStatus(query.status, ALLOWED_STATUS.mail);
    const rows = await this.prisma.enterpriseMail.findMany({
      where: {
        ...this.filters(query).mail,
        ...(query.status === 'RETRYING'
          ? { status: 'PENDING', attempts: { gte: 2 } }
          : { status: query.status ?? 'PENDING' }),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      cursor: query.cursor ? { id: decodeCursor(query.cursor) } : undefined,
      skip: query.cursor ? 1 : 0,
      take: limit + 1,
      select: {
        id: true,
        kind: true,
        status: true,
        attempts: true,
        nextAttemptAt: true,
        createdAt: true,
        sentAt: true,
        enrollment: {
          select: { organization: { select: { id: true, name: true } } },
        },
      },
    });
    const page = this.page(rows, limit);
    return {
      ...page,
      // Metadata only: recipient, subject and body never leave the mail table.
      items: page.items.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        attempts: row.attempts,
        nextAttemptAt: row.nextAttemptAt,
        createdAt: row.createdAt,
        sentAt: row.sentAt,
        ageSeconds: ageSeconds(row.createdAt, now) ?? 0,
        organization: row.enrollment?.organization ?? null,
      })),
    };
  }
}
