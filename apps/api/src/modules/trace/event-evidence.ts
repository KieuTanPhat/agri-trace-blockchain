import type { Prisma } from '../../generated/prisma/client.js';
import { harvestSensorTraceEvidenceMatches } from '../iot/harvest-sensor-evidence.js';
import {
  EVENT_BINDING_CONTEXT_INCLUDE,
  EVENT_LEDGER_ROUTE_INCLUDE,
  routeProofMatches,
  verifiedEventRoute,
} from './ledger-route.js';
import { privateTraceEvidenceMatches } from './trace-evidence.js';

/** Everything needed to re-verify an event from the database alone. */
export const EVENT_EVIDENCE_INCLUDE = {
  ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE,
  ledgerRouteExemption: true,
  bindingContext: EVENT_BINDING_CONTEXT_INCLUDE,
  blockchainProof: true,
} as const;
export type EvidenceRow = Prisma.TraceEventGetPayload<{
  include: typeof EVENT_EVIDENCE_INCLUDE;
}>;

/** The single definition of "this event still verifies locally": the pinned
 * route is intact, a stored proof matches it, the private row hashes to the
 * recorded commitment (version-dispatched, including release-C signatures)
 * and sensor evidence is consistent. */
export async function localEvidence(
  db: Prisma.TransactionClient,
  event: EvidenceRow,
) {
  const route = verifiedEventRoute(event);
  const sensorMatches = await harvestSensorTraceEvidenceMatches(db, event);
  const proof = event.blockchainProof;
  return {
    route,
    sensorMatches,
    localHashMatches:
      Boolean(route) &&
      (!proof || routeProofMatches(event, proof)) &&
      privateTraceEvidenceMatches(event) &&
      sensorMatches,
  };
}

export type EvidenceReport = {
  checked: number;
  failed: Array<{ eventId: string; schemaVersion: string; eventType: string }>;
  bySchemaVersion: Record<string, number>;
};

/** Re-verifies stored events in pages; used by restore drills and operators.
 * It reads only the database, so it works on a restored copy. */
export async function verifyStoredEvidence(
  db: Prisma.TransactionClient,
  options: { batchSize?: number; where?: Prisma.TraceEventWhereInput } = {},
): Promise<EvidenceReport> {
  const report: EvidenceReport = {
    checked: 0,
    failed: [],
    bySchemaVersion: {},
  };
  const take = options.batchSize ?? 500;
  let cursor: string | undefined;
  for (;;) {
    const page = await db.traceEvent.findMany({
      where: options.where,
      include: EVENT_EVIDENCE_INCLUDE,
      orderBy: { id: 'asc' },
      take,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!page.length) return report;
    for (const event of page) {
      report.checked += 1;
      report.bySchemaVersion[event.schemaVersion] =
        (report.bySchemaVersion[event.schemaVersion] ?? 0) + 1;
      if (!(await localEvidence(db, event)).localHashMatches)
        report.failed.push({
          eventId: event.id,
          schemaVersion: event.schemaVersion,
          eventType: event.eventType,
        });
    }
    cursor = page[page.length - 1].id;
  }
}
