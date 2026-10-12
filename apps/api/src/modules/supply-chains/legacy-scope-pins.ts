import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import type { LegacyScopeManifest } from './legacy-scope-manifest.js';
import type { buildLegacyScopeAssignmentPlan } from './legacy-scope-plan.js';

export interface LegacyScopePin {
  manifest: LegacyScopeManifest;
  digest: string;
  plan: ReturnType<typeof buildLegacyScopeAssignmentPlan>;
}

/** Operator-owned file, independent of the DB and HTTP request. Re-read for
 * every authorization/filter; a process cache must not preserve withdrawn pins.
 * An absent or invalid file closes legacy mapping access without opening a
 * fallback to global roles. No credentials belong in this artifact. */
export function legacyScopePins(): LegacyScopePin[] {
  const file = process.env.HYBRID_LEGACY_MANIFEST_PINS_FILE;
  if (!file) return [];
  try {
    if (!isAbsolute(file)) throw new Error();
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024)
      throw new Error();
    if (process.platform !== 'win32' && stat.mode & 0o022) throw new Error();
    const data = JSON.parse(readFileSync(file, 'utf8')) as {
      schema: string;
      pins: LegacyScopePin[];
    };
    if (
      data.schema !== 'agritrace-legacy-scope-pins-1' ||
      !Array.isArray(data.pins) ||
      data.pins.length > 100
    )
      throw new Error();
    const seen = new Set<string>();
    for (const pin of data.pins) {
      const { digest: planDigest, ...planBody } = pin.plan;
      if (
        !/^[a-f0-9]{64}$/.test(pin.digest) ||
        canonicalSha256(pin.manifest) !== pin.digest ||
        canonicalSha256(planBody) !== planDigest ||
        pin.plan.manifestDigest !== pin.digest ||
        pin.plan.manifestId !== pin.manifest.id ||
        seen.has(pin.manifest.id)
      )
        throw new Error();
      seen.add(pin.manifest.id);
    }
    return data.pins;
  } catch {
    // Fail closed in query predicates too; do not expose a filesystem path.
    return [];
  }
}

export function requireLegacyScopePin(id: string) {
  const pin = legacyScopePins().find((item) => item.manifest.id === id);
  if (!pin)
    throw new ForbiddenException('Manifest legacy chưa được pin độc lập');
  return pin;
}

export function trustedLegacyCycleWhere(): Prisma.ProductionCycleWhereInput {
  return {
    OR: [
      { legacyScopeMapping: { is: null } },
      ...legacyScopePins().flatMap((pin) =>
        pin.manifest.entries
          .filter((entry) => entry.decision === 'MAP')
          .map((entry): Prisma.ProductionCycleWhereInput => ({
            id: entry.cycleId,
            chainId: entry.chainId,
            legacyScopeMapping: {
              is: {
                manifestId: pin.manifest.id,
                chainId: entry.chainId,
                manifest: {
                  is: {
                    digest: pin.digest,
                    document: {
                      equals: pin.manifest as unknown as Prisma.InputJsonValue,
                    },
                    plan: {
                      equals: pin.plan as unknown as Prisma.InputJsonValue,
                    },
                  },
                },
              },
            },
          })),
      ),
    ],
  };
}

export async function assertLegacyScopeProvenance(
  db: Prisma.TransactionClient,
  cycleId: string,
) {
  const mapping = await db.legacyScopeMapping.findUnique({
    where: { cycleId },
    include: { manifest: true, cycle: { select: { chainId: true } } },
  });
  if (!mapping) return;
  const pin = requireLegacyScopePin(mapping.manifestId);
  const entry = pin.manifest.entries.find((item) => item.cycleId === cycleId);
  const checkpoint = entry
    ? canonicalSha256({
        schema: 'agritrace-legacy-checkpoint-1',
        manifestDigest: pin.digest,
        entry,
        proposalKeys: pin.plan.proposals
          .filter((p) => p.cycleId === cycleId)
          .map((p) => p.key),
        actorGrants: mapping.actorGrants,
      })
    : null;
  if (
    !entry ||
    mapping.checkpointDigest !== checkpoint ||
    entry.chainId !== mapping.chainId ||
    mapping.cycle.chainId !== entry.chainId ||
    mapping.manifest.digest !== pin.digest ||
    canonicalSha256(mapping.manifest.document) !== pin.digest ||
    canonicalSha256(mapping.manifest.plan) !== canonicalSha256(pin.plan)
  )
    throw new ForbiddenException(
      'Provenance legacy không khớp manifest đã review',
    );
}
