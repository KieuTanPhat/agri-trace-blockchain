import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { commandContext } from '../../common/idempotency/command-transaction.js';
import { requestContext } from '../../common/request/request-context.js';

export const GENESIS_HASH = '0'.repeat(64);

/** Every audited transaction takes this lock BEFORE any row lock. Appending an
 * entry takes the same lock; because no audited transaction can hold a row lock
 * while waiting for it, the lock cannot take part in a deadlock cycle (and the
 * FK checks of the audit insert never wait behind another audited writer).
 * It also serializes status changes, closing write-skew races such as two
 * administrators disabling each other. Advisory transaction locks are
 * re-entrant, so taking it again is harmless. */
export async function lockPlatformAudit(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('platform_audit', 0))`;
}

const AUDITED_OPERATIONS = new Set([
  'PRIVACY_REQUEST_CREATE',
  'ENTERPRISE_SERVICE_PAY',
  'CREATE_USERS',
  'CREATE_ORGANIZATIONS',
  'GRANT_COMPLIANCE_ASSIGNMENT',
  'REVOKE_COMPLIANCE_ASSIGNMENT',
  'ENTERPRISE_REVIEW',
  'ENTERPRISE_ACTIVATE',
  'ENTERPRISE_PROFILE_REVIEW',
  'ENTERPRISE_CONNECTION_REVIEW',
]);
const AUDITED_WHEN_PLATFORM = new Set([
  'HYB_GRANT_ROLE',
  'HYB_REVOKE_ROLE',
  'HYB_SET_CAPABILITY',
]);

/** True for commands whose transaction appends a platform audit entry. */
export function isAuditedCommand(operation: string, actorRole?: string) {
  return (
    operation.startsWith('PLATFORM_') ||
    AUDITED_OPERATIONS.has(operation) ||
    (AUDITED_WHEN_PLATFORM.has(operation) && actorRole === 'SYSTEM_ADMIN')
  );
}

export type PlatformAuditOutcome = 'SUCCESS' | 'DENIED' | 'FAILED';

export interface PlatformAuditInput {
  /** null records a system-originated event (for example automatic lockout). */
  actor: { sub: string | null; role: string } | null;
  action: string;
  subjectType: string;
  subjectId: string;
  organizationId?: string | null;
  reason?: string | null;
  outcome?: PlatformAuditOutcome;
  details?: Record<string, unknown>;
  /** Overrides the ambient request id (used by tests and background jobs). */
  requestId?: string | null;
  idempotencyKey?: string | null;
}

const SECRET_KEY =
  /(password|passwd|secret|token|otp|recovery|authorization|cookie|private)/iu;

/** Audit details never carry credentials. Matching keys are masked so a caller
 * passing a whole DTO cannot leak a password, OTP, MFA secret or token. */
export function redactDetails(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 6) return '[TRUNCATED]';
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => redactDetails(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = SECRET_KEY.test(key)
      ? '[REDACTED]'
      : redactDetails(item, depth + 1);
  }
  return out;
}

export interface HashableAuditRow {
  sequence: bigint | string;
  occurredAt: Date;
  actorUserId: string | null;
  actorRole: string;
  action: string;
  subjectType: string;
  subjectId: string;
  organizationId: string | null;
  reason: string | null;
  requestId: string | null;
  idempotencyKey: string | null;
  outcome: string;
  details: unknown;
  prevHash: string;
}

export function platformAuditEntryHash(row: HashableAuditRow): string {
  return canonicalSha256({
    sequence: row.sequence.toString(),
    occurredAt: row.occurredAt.toISOString(),
    actorUserId: row.actorUserId,
    actorRole: row.actorRole,
    action: row.action,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    organizationId: row.organizationId,
    reason: row.reason,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    outcome: row.outcome,
    details: row.details,
    prevHash: row.prevHash,
  });
}

/** Appends one entry to the hash chain. It must run on the SAME transaction
 * client as the audited write so the write and its evidence commit together.
 * The database trigger re-checks sequence/prev_hash under an advisory lock. */
export async function appendPlatformAudit(
  tx: Prisma.TransactionClient,
  input: PlatformAuditInput,
) {
  await lockPlatformAudit(tx);
  const head = await tx.platformAudit.findFirst({
    orderBy: { sequence: 'desc' },
    select: { sequence: true, entryHash: true },
  });
  const occurredAt = new Date();
  const row = {
    sequence: (head?.sequence ?? 0n) + 1n,
    occurredAt,
    actorUserId: input.actor?.sub ?? null,
    // An actor without a user id (system or device) is recorded as SYSTEM.
    actorRole: input.actor?.sub ? input.actor.role : 'SYSTEM',
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    organizationId: input.organizationId ?? null,
    reason: input.reason?.trim() || null,
    requestId:
      input.requestId ??
      requestContext.getStore()?.requestId?.slice(0, 100) ??
      null,
    idempotencyKey:
      input.idempotencyKey ??
      commandContext.getStore()?.input.idempotencyKey?.slice(0, 255) ??
      null,
    outcome: input.outcome ?? 'SUCCESS',
    details: redactDetails(input.details ?? {}) as Prisma.InputJsonObject,
    prevHash: head?.entryHash ?? GENESIS_HASH,
  };
  return tx.platformAudit.create({
    data: { ...row, entryHash: platformAuditEntryHash(row) },
  });
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  headSequence: string | null;
  headHash: string | null;
  firstInvalid: { sequence: string; reason: string } | null;
}

/** Re-derives every link from the stored rows. Read-only; tampering that the
 * triggers could not prevent (for example a restored/edited table) shows here. */
export async function verifyPlatformAuditChain(
  db:
    | Prisma.TransactionClient
    | import('../../prisma/prisma.service.js').PrismaService,
  batchSize = 500,
): Promise<ChainVerification> {
  let expectedSequence = 1n;
  let expectedPrev = GENESIS_HASH;
  let checked = 0;
  let cursor = 0n;
  for (;;) {
    const rows = await db.platformAudit.findMany({
      where: { sequence: { gt: cursor } },
      orderBy: { sequence: 'asc' },
      take: batchSize,
    });
    if (!rows.length) break;
    for (const row of rows) {
      const fail = (reason: string): ChainVerification => ({
        ok: false,
        checked,
        headSequence: null,
        headHash: null,
        firstInvalid: { sequence: row.sequence.toString(), reason },
      });
      if (row.sequence !== expectedSequence)
        return fail(`Thiếu hoặc lệch số thứ tự (cần ${expectedSequence})`);
      if (row.prevHash !== expectedPrev)
        return fail('prev_hash không khớp bản ghi trước');
      if (platformAuditEntryHash(row) !== row.entryHash)
        return fail('entry_hash không khớp nội dung bản ghi');
      expectedPrev = row.entryHash;
      expectedSequence += 1n;
      cursor = row.sequence;
      checked += 1;
    }
  }
  return {
    ok: true,
    checked,
    headSequence: checked ? (expectedSequence - 1n).toString() : null,
    headHash: checked ? expectedPrev : null,
    firstInvalid: null,
  };
}
