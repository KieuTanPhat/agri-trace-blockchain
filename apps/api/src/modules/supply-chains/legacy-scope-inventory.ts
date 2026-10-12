import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { privateTraceEvidenceMatches } from '../trace/trace-evidence.js';
import type { LegacyScopeInventory } from './legacy-scope-manifest.js';

/** Caller owns a REPEATABLE READ, read-only snapshot. Artifact contains only
 * identifiers/counts/digests. Hashes include private rows inside the process;
 * bodies, QR tokens and credentials must never be emitted into the manifest. */
export async function inventoryLegacyScope(
  db: Prisma.TransactionClient,
): Promise<LegacyScopeInventory> {
  if (
    await db.traceEvent.findFirst({
      where: { cycleId: null, lotId: null },
      select: { id: true },
    })
  )
    throw new Error(
      'Legacy event without a resolvable root requires explicit reconciliation',
    );
  const cycles = await db.productionCycle.findMany({
    where: { chainId: null },
    orderBy: { id: 'asc' },
    take: 10001,
    include: {
      careRecords: { orderBy: { id: 'asc' } },
      sensorReadings: { orderBy: { id: 'asc' } },
      sensorDigests: { orderBy: { id: 'asc' } },
      sensorReconciliations: { orderBy: { id: 'asc' } },
      harvestSensorWindows: { orderBy: { id: 'asc' } },
      certificates: { orderBy: { id: 'asc' } },
      devices: { orderBy: { id: 'asc' } },
      harvestEvents: {
        orderBy: { id: 'asc' },
        include: {
          lot: {
            include: {
              traceQr: true,
              certificates: { orderBy: { id: 'asc' } },
              inspections: { orderBy: { id: 'asc' } },
              quantityMovements: { orderBy: { id: 'asc' } },
              shipment: {
                include: {
                  trackingBindings: { orderBy: { id: 'asc' } },
                  telemetry: { orderBy: { id: 'asc' } },
                  telemetryDigest: true,
                },
              },
            },
          },
        },
      },
    },
  });
  if (cycles.length > 10000)
    throw new Error('Legacy inventory needs a bounded paging rehearsal');
  const roots: LegacyScopeInventory['roots'] = [];
  for (const cycle of cycles) {
    const lots = cycle.harvestEvents.flatMap((harvest) =>
      harvest.lot ? [harvest.lot] : [],
    );
    if (lots.some((lot) => lot.farmOrgId !== cycle.farmOrgId))
      throw new Error('Legacy Lot producer disagrees with root');
    const events = await db.traceEvent.findMany({
      where: {
        OR: [
          { cycleId: cycle.id },
          { lotId: { in: lots.map((lot) => lot.id) } },
        ],
      },
      orderBy: { id: 'asc' },
      include: { blockchainProof: true, blockchainOutbox: true },
    });
    if (
      events.some(
        (event) =>
          (event.cycleId && event.cycleId !== cycle.id) ||
          (event.lotId && !lots.some((lot) => lot.id === event.lotId)) ||
          !privateTraceEvidenceMatches(event) ||
          (event.blockchainProof &&
            event.blockchainProof.dataHash !== event.dataHash),
      )
    )
      throw new Error('Legacy event subject or evidence disagrees with root');
    const snapshot = JSON.parse(
      JSON.stringify({ cycle, events }, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ) as unknown;
    roots.push({
      cycleId: cycle.id,
      producerOrgId: cycle.farmOrgId,
      version: cycle.version,
      active:
        !['COMPLETED', 'CANCELLED'].includes(cycle.currentState) ||
        lots.some(
          (lot) =>
            !['SOLD', 'RECALLED', 'EXPIRED', 'DAMAGED'].includes(
              lot.currentState,
            ),
        ) ||
        lots.some(
          (lot) => lot.shipment && lot.shipment.status !== 'DELIVERED',
        ) ||
        events.some(
          (event) =>
            event.blockchainOutbox &&
            event.blockchainOutbox.status !== 'COMPLETED',
        ),
      inventoryDigest: canonicalSha256(snapshot),
      counts: {
        harvests: cycle.harvestEvents.length,
        lots: lots.length,
        shipments: lots.filter((lot) => lot.shipment).length,
        qr: lots.filter((lot) => lot.traceQr).length,
        traceEvents: events.length,
        outbox: events.filter((event) => event.blockchainOutbox).length,
        proofs: events.filter((event) => event.blockchainProof).length,
        devices: cycle.devices.length,
        sensorReadings: cycle.sensorReadings.length,
        certificates:
          cycle.certificates.length +
          lots.reduce((count, lot) => count + lot.certificates.length, 0),
      },
    });
  }
  const body = { schema: 'agritrace-legacy-inventory-1' as const, roots };
  return { ...body, digest: canonicalSha256(body) };
}
