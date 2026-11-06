import { UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export type PhotoRef = { evidenceId: string; sha256: string };
export type PhasePhoto = PhotoRef & { phase: string };

/**
 * Photos the actor's organization uploaded for one transfer or lot, sorted by
 * id. The stored sha256 is what the digests and trace events commit to.
 */
export async function ownPhotos(
  tx: Prisma.TransactionClient,
  organizationId: string,
  entityType: 'TRANSFER' | 'LOT',
  entityId: string,
  kind: 'TRANSFER_IMAGE' | 'DAMAGE_IMAGE',
  ids: string[] = [],
): Promise<PhotoRef[]> {
  if (new Set(ids).size !== ids.length) throw new UnprocessableEntityException('Ảnh bị chọn trùng');
  if (!ids.length) return [];
  const rows = await tx.traceEvidence.findMany({
    where: { id: { in: ids }, organizationId, entityType, entityId, kind, withdrawal: null },
    select: { id: true, sha256: true },
  });
  if (rows.length !== ids.length)
    throw new UnprocessableEntityException('Ảnh phải do tổ chức của bạn chụp cho đúng chuyến hoặc lô này');
  return rows.map((r) => ({ evidenceId: r.id, sha256: r.sha256 })).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
}

/** Digest the transfer snapshot carries for its pickup and delivery photos. */
export function handoverPhotosDigest(transferId: string, photos: PhasePhoto[]) {
  return canonicalSha256({
    transferId,
    photos: photos
      .map((p) => ({ phase: p.phase, evidenceId: p.evidenceId, sha256: p.sha256 }))
      .sort((a, b) => a.phase.localeCompare(b.phase) || a.evidenceId.localeCompare(b.evidenceId)),
  });
}

/** True once any organization signed the phase, in either protocol. */
export async function phaseSigned(tx: Prisma.TransactionClient, transferId: string, phase: string) {
  return (
    (await tx.distributionAttestation.count({ where: { transferId, phase } })) > 0 ||
    (await tx.distributionSignedIntent.count({ where: { transferId, documentType: 'TRANSFER', phase } })) > 0
  );
}
