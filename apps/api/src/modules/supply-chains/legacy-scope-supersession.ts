import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedCommand } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  requireLegacyScopePin,
  type LegacyScopePin,
} from './legacy-scope-pins.js';

/** Positive evidence permits inspection/replay, never execution of an obsolete
 * apply. Authorization still checks current account/session/operator or grant. */
export async function hasLegacyCommittedReplay(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
) {
  if (!input.idempotencyKey) return false;
  const record = await db.idempotencyRecord.findUnique({
    where: {
      requesterId_operation_idempotencyKey: {
        requesterId: input.requesterId,
        operation: input.operation,
        idempotencyKey: input.idempotencyKey.trim(),
      },
    },
    include: { commandCommit: true },
  });
  return Boolean(
    record?.requestHash === canonicalSha256(input.payload) &&
    record.commandCommit?.operation === input.operation &&
    record.commandCommit.requesterId === input.requesterId &&
    record.commandCommit.authorizationScope === record.authorizationScope,
  );
}

export async function legacyRootSuperseded(
  db: Prisma.TransactionClient,
  manifestId: string,
  cycleId: string,
) {
  return Boolean(
    await db.legacyScopeSupersession.findUnique({
      where: {
        fromManifestId_cycleId: { fromManifestId: manifestId, cycleId },
      },
    }),
  );
}

/** Runs under the legacy review lock and snapshot lock, in registration's
 * transaction. The new independently pinned v2 artifact chooses exact old roots;
 * it cannot retire an applied mapping or silently change an approved target. */
export async function planLegacySupersessions(
  db: Prisma.TransactionClient,
  pin: LegacyScopePin,
) {
  const replacements = pin.manifest.supersedes ?? [];
  const records = await db.legacyScopeManifestRecord.findMany();
  for (const entry of pin.manifest.entries.filter(
    (e) => e.decision === 'MAP',
  )) {
    for (const record of records) {
      if (record.id === pin.manifest.id) continue;
      const document = record.document as unknown as LegacyScopePin['manifest'];
      if (
        document.entries.some(
          (old) => old.cycleId === entry.cycleId && old.decision === 'MAP',
        ) &&
        !(await legacyRootSuperseded(db, record.id, entry.cycleId)) &&
        !replacements.some(
          (r) => r.manifestId === record.id && r.cycleId === entry.cycleId,
        )
      )
        throw new ConflictException(
          'Root đã có review MAP; cần supersession được pin rõ',
        );
    }
  }
  for (const replacement of replacements) {
    const old = requireLegacyScopePin(replacement.manifestId);
    const record = records.find((r) => r.id === replacement.manifestId);
    if (
      !record ||
      replacement.manifestDigest !== old.digest ||
      record.digest !== old.digest ||
      canonicalSha256(record.document) !== old.digest ||
      canonicalSha256(record.plan) !== canonicalSha256(old.plan)
    )
      throw new ForbiddenException(
        'Supersession không khớp pin/provenance trước',
      );
    const from = old.manifest.entries.find(
      (e) => e.cycleId === replacement.cycleId,
    );
    const to = pin.manifest.entries.find(
      (e) => e.cycleId === replacement.cycleId,
    );
    if (
      !from ||
      !to ||
      (from.decision === 'MAP' &&
        (to.decision !== 'MAP' || to.chainId !== from.chainId))
    )
      throw new ConflictException(
        'Supersession không được đổi target MAP đã review',
      );
    if (
      (await legacyRootSuperseded(db, old.manifest.id, replacement.cycleId)) ||
      (await db.legacyScopeMapping.findUnique({
        where: { cycleId: replacement.cycleId },
      }))
    )
      throw new ConflictException('Root đã được thay review hoặc đã MAP');
    const unknown = await db.idempotencyRecord.findFirst({
      where: {
        operation: 'SCOPE_APPLY_LEGACY_ROOT',
        requestHash: canonicalSha256({
          manifestId: old.manifest.id,
          cycleId: replacement.cycleId,
        }),
        commandCommit: { is: null },
        OR: [
          { status: { not: 'FAILED' } },
          { responseStatus: null },
          { responseStatus: { lt: 400 } },
        ],
      },
    });
    if (unknown)
      throw new ConflictException(
        'Apply trước chưa rõ kết quả; cần đối soát trước supersession',
      );
  }
  return replacements.map((r) => ({
    fromManifestId: r.manifestId,
    toManifestId: pin.manifest.id,
    cycleId: r.cycleId,
  }));
}
