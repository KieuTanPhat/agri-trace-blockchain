import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { appendPlatformAudit } from '../platform-governance/platform-audit.js';
import { RESOURCES } from '../billing/billing-core.js';

type Tx = Prisma.TransactionClient;
const int = (min: number, max: number) => (v: unknown) =>
  Number.isInteger(v) && (v as number) >= min && (v as number) <= max;

/** Only these business parameters may be edited; each has a validator.
 * Secrets, keys and ledger/controller configuration are never settings. */
export const SETTING_RULES: Record<string, { valid: (v: unknown) => boolean; hint: string }> = {
  'billing.graceDays': { valid: int(0, 90), hint: 'số nguyên 0–90' },
  'billing.invoiceDueDays': { valid: int(1, 90), hint: 'số nguyên 1–90' },
  'billing.participantLimits': {
    valid: (v) =>
      !!v && typeof v === 'object' && !Array.isArray(v) &&
      RESOURCES.every((r) => int(0, 100_000_000)((v as Record<string, unknown>)[r])),
    hint: 'đối tượng {products, chains, members, qrLabels} số nguyên ≥ 0',
  },
  'processing.massBalanceTolerancePercent': {
    valid: (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10,
    hint: 'số 0–10 (%)',
  },
  'consumerReports.maxPerHour': { valid: int(1, 100), hint: 'số nguyên 1–100' },
  'enrollment.reviewSlaHours': { valid: int(1, 720), hint: 'số nguyên 1–720' },
  'support.reviewSlaHours': { valid: int(1, 720), hint: 'số nguyên 1–720' },
  'notifications.enrollmentDecisionEmail': { valid: (v) => typeof v === 'boolean', hint: 'true/false' },
  'notifications.renewalReminderDays': { valid: int(1, 120), hint: 'số nguyên 1–120' },
};

export function assertSetting(key: string, value: unknown) {
  const rule = SETTING_RULES[key];
  if (!rule) throw new UnprocessableEntityException('Tham số không được phép chỉnh sửa');
  if (!rule.valid(value))
    throw new UnprocessableEntityException(`Giá trị không hợp lệ: cần ${rule.hint}`);
}

export async function changeSettingTx(
  tx: Tx,
  actor: CommandActor,
  input: { key: string; value: unknown; version: number; reason: string },
) {
  assertSetting(input.key, input.value);
  const before = await tx.platformSetting.findUnique({ where: { key: input.key } });
  if (!before) throw new NotFoundException('Không tìm thấy tham số');
  const changed = await tx.platformSetting.updateMany({
    where: { key: input.key, version: input.version },
    data: {
      value: input.value as Prisma.InputJsonValue,
      version: { increment: 1 },
      updatedBy: actor.sub,
      updatedAt: new Date(),
    },
  });
  if (changed.count !== 1) throw new ConflictException('Tham số đã thay đổi; tải lại');
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'PLATFORM_SETTING_CHANGED',
    subjectType: 'PLATFORM_SETTING',
    subjectId: input.key,
    reason: input.reason,
    details: { key: input.key, before: before.value, after: input.value, version: input.version },
  });
  return tx.platformSetting.findUniqueOrThrow({ where: { key: input.key } });
}

export async function blockQrTx(
  tx: Tx,
  actor: CommandActor,
  input: { lotId: string; reason: string; publicMessage: string },
) {
  await tx.$queryRaw`SELECT lot_id FROM lot WHERE lot_id=${input.lotId}::uuid FOR UPDATE`;
  const lot = await tx.lot.findUnique({ where: { id: input.lotId }, include: { traceQr: true } });
  if (!lot?.traceQr) throw new NotFoundException('Lô chưa có mã QR');
  if (await tx.traceQrBlock.findFirst({ where: { lotId: lot.id, unblockedAt: null } }))
    throw new ConflictException('Mã QR đang bị khóa');
  const row = await tx.traceQrBlock.create({
    data: { lotId: lot.id, reason: input.reason, publicMessage: input.publicMessage, blockedBy: actor.sub! },
  });
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'TRACE_QR_BLOCKED',
    subjectType: 'LOT',
    subjectId: lot.id,
    organizationId: lot.farmOrgId,
    reason: input.reason,
    details: { lotCode: lot.lotCode, publicMessage: input.publicMessage },
  });
  return row;
}

export async function unblockQrTx(
  tx: Tx,
  actor: CommandActor,
  input: { blockId: string; version: number; reason: string },
) {
  const changed = await tx.traceQrBlock.updateMany({
    where: { id: input.blockId, version: input.version, unblockedAt: null },
    data: { unblockedAt: new Date(), unblockedBy: actor.sub, unblockReason: input.reason, version: { increment: 1 } },
  });
  if (changed.count !== 1) throw new ConflictException('Khóa QR đã được xử lý hoặc đã thay đổi');
  const row = await tx.traceQrBlock.findUniqueOrThrow({ where: { id: input.blockId } });
  const lot = await tx.lot.findUniqueOrThrow({ where: { id: row.lotId } });
  await appendPlatformAudit(tx, {
    actor: { sub: actor.sub, role: actor.role },
    action: 'TRACE_QR_UNBLOCKED',
    subjectType: 'LOT',
    subjectId: row.lotId,
    organizationId: lot.farmOrgId,
    reason: input.reason,
    details: { blockId: row.id, lotCode: lot.lotCode },
  });
  return row;
}

/** Active administrative block, if any, for the public trace page and label printing. */
export async function activeQrBlock(db: Tx, lotId: string) {
  return db.traceQrBlock.findFirst({ where: { lotId, unblockedAt: null } });
}
