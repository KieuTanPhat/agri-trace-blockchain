import { createHash } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

const PNG_SIGNATURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp3sAAAAASUVORK5CYII=',
  'base64',
);

/** Seed private cycle evidence without emitting an evidence-attachment event.
 * Business-flow tests use this to satisfy the current harvest/care contract. */
export async function seedCycleEvidence(
  db: Pick<PrismaClient, 'traceEvidence'>,
  input: { organizationId: string; cycleId: string; actorId: string },
) {
  const sha256 = createHash('sha256').update(PNG_SIGNATURE).digest('hex');
  const refs: Record<string, string> = {};
  for (const kind of ['CARE_IMAGE', 'HARVEST_IMAGE', 'LOT_IMAGE']) {
    const row = await db.traceEvidence.create({
      data: {
        organizationId: input.organizationId,
        entityType: 'CYCLE',
        entityId: input.cycleId,
        fileName: `${kind.toLowerCase()}.png`,
        mediaType: 'image/png',
        size: PNG_SIGNATURE.length,
        sha256,
        content: PNG_SIGNATURE,
        description: 'Private test fixture evidence',
        kind,
        public: false,
        actorId: input.actorId,
      },
      select: { id: true },
    });
    refs[kind] = row.id;
  }
  return {
    careEvidenceRef: refs.CARE_IMAGE,
    harvestEvidenceRef: refs.HARVEST_IMAGE,
    lotImageEvidenceRef: refs.LOT_IMAGE,
  };
}
