import { isUUID } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import {
  validateLegacyScopeManifest,
  type LegacyScopeInventory,
  type LegacyScopeManifest,
} from './legacy-scope-manifest.js';
import { preflightLegacyScope } from './legacy-scope-preflight.js';

export interface LegacyPlanningRoot {
  id: string;
  chainId: string | null;
  farmOrgId: string;
  version: number;
  lots: Array<{
    id: string;
    farmOrgId: string;
    shipment: {
      id: string;
      lotId: string;
      transporterOrgId: string;
      retailerOrgId: string;
    } | null;
  }>;
}

/** Read-only proposal artifact. It neither accepts an assignment nor authorizes
 * apply; participant confirmation, provenance and journal bridges stay gated. */
export function buildLegacyScopeAssignmentPlan(
  manifest: LegacyScopeManifest,
  inventory: LegacyScopeInventory,
  pin: string,
  expected: { environment: 'isolated' | 'production'; sourceSha: string },
  roots: LegacyPlanningRoot[],
) {
  const checked = validateLegacyScopeManifest(
    manifest,
    inventory,
    pin,
    expected,
  );
  const mapped = manifest.entries.filter((entry) => entry.decision === 'MAP');
  const rootById = new Map(roots.map((root) => [root.id, root]));
  if (rootById.size !== roots.length || roots.length !== mapped.length)
    throw new Error(
      'Legacy assignment plan requires every mapped root exactly once',
    );
  const subjects = new Set<string>();
  const proposals: Array<{
    key: string;
    chainId: string;
    cycleId: string;
    organizationId: string;
    stage: 'PRODUCTION' | 'TRANSPORT' | 'RETAIL';
    subject: { kind: 'cycle' | 'shipment' | 'lot'; id: string };
    status: 'PROPOSED';
    requiresParticipantConfirmation: true;
  }> = [];
  const add = (
    chainId: string,
    cycleId: string,
    organizationId: string,
    stage: 'PRODUCTION' | 'TRANSPORT' | 'RETAIL',
    kind: 'cycle' | 'shipment' | 'lot',
    subjectId: string,
  ) => {
    if (
      ![chainId, cycleId, organizationId, subjectId].every((id) => isUUID(id))
    )
      throw new Error('Legacy assignment plan contains an invalid identifier');
    const subject = { kind, id: subjectId };
    const key = canonicalSha256({
      schema: 'agritrace-legacy-assignment-key-1',
      manifestDigest: pin,
      chainId,
      cycleId,
      organizationId,
      stage,
      subject,
    });
    proposals.push({
      key,
      chainId,
      cycleId,
      organizationId,
      stage,
      subject,
      status: 'PROPOSED',
      requiresParticipantConfirmation: true,
    });
    if (proposals.length > 10000)
      throw new Error(
        'Legacy assignment plan needs a bounded paging rehearsal',
      );
  };
  for (const entry of mapped) {
    const root = rootById.get(entry.cycleId);
    if (
      !root ||
      root.chainId !== null ||
      root.farmOrgId !== entry.producerOrgId ||
      root.version !== entry.expectedVersion
    )
      throw new Error('Legacy assignment plan root provenance changed');
    const count = inventory.roots.find(
      (item) => item.cycleId === root.id,
    )!.counts;
    if (
      root.lots.length !== count.lots ||
      root.lots.filter((lot) => lot.shipment !== null).length !==
        count.shipments
    )
      throw new Error('Legacy assignment plan child inventory changed');
    const chainId = entry.chainId!;
    add(chainId, root.id, root.farmOrgId, 'PRODUCTION', 'cycle', root.id);
    for (const lot of root.lots) {
      if (lot.farmOrgId !== root.farmOrgId || subjects.has(`lot:${lot.id}`))
        throw new Error('Legacy assignment plan Lot provenance changed');
      subjects.add(`lot:${lot.id}`);
      if (!lot.shipment) continue;
      const shipment = lot.shipment;
      if (shipment.lotId !== lot.id || subjects.has(`shipment:${shipment.id}`))
        throw new Error('Legacy assignment plan Shipment provenance changed');
      subjects.add(`shipment:${shipment.id}`);
      add(
        chainId,
        root.id,
        shipment.transporterOrgId,
        'TRANSPORT',
        'shipment',
        shipment.id,
      );
      add(chainId, root.id, shipment.retailerOrgId, 'RETAIL', 'lot', lot.id);
    }
  }
  proposals.sort((a, b) => a.key.localeCompare(b.key));
  const body = {
    schema: 'agritrace-legacy-assignment-plan-1' as const,
    manifestId: manifest.id,
    manifestDigest: pin,
    inventoryDigest: inventory.digest,
    sourceSha: expected.sourceSha,
    environment: expected.environment,
    proposals,
    unresolved: checked.unresolved,
    activeUnresolved: checked.activeUnresolved,
    applyReady: false as const,
    cutoverReady: false as const,
  };
  return { ...body, digest: canonicalSha256(body) };
}

/** Caller owns the same REPEATABLE READ / READ ONLY snapshot used for inventory.
 * All authority checks precede collecting proposed subjects. No writes occur. */
export async function planLegacyScopeAssignments(
  db: Prisma.TransactionClient,
  manifest: LegacyScopeManifest,
  inventory: LegacyScopeInventory,
  pin: string,
  expected: { environment: 'isolated' | 'production'; sourceSha: string },
) {
  validateLegacyScopeManifest(manifest, inventory, pin, expected);
  await preflightLegacyScope(db, manifest);
  const roots: LegacyPlanningRoot[] = [];
  for (const entry of manifest.entries) {
    if (entry.decision !== 'MAP') continue;
    const root = await db.productionCycle.findUniqueOrThrow({
      where: { id: entry.cycleId },
      select: {
        id: true,
        chainId: true,
        farmOrgId: true,
        version: true,
        harvestEvents: {
          select: {
            lot: {
              select: {
                id: true,
                farmOrgId: true,
                shipment: {
                  select: {
                    id: true,
                    lotId: true,
                    transporterOrgId: true,
                    retailerOrgId: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    roots.push({
      id: root.id,
      chainId: root.chainId,
      farmOrgId: root.farmOrgId,
      version: root.version,
      lots: root.harvestEvents.flatMap((harvest) =>
        harvest.lot ? [harvest.lot] : [],
      ),
    });
  }
  return buildLegacyScopeAssignmentPlan(
    manifest,
    inventory,
    pin,
    expected,
    roots,
  );
}
