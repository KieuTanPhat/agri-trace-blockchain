import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { privateTraceEvidenceMatches } from './trace-evidence.js';
import {
  assertPinnedLedgerRoute,
  EVENT_LEDGER_ROUTE_INCLUDE,
  routePayload,
  sameLedgerDestination,
  verifiedEventRoute,
  type PinnedRoute,
} from './ledger-route.js';
import {
  validateRouteImportArtifact,
  verifiedRouteImportArtifact,
  type RouteEnvironment,
  type RouteImportArtifact,
} from './ledger-route-import-artifact.js';

export interface RouteInventoryEntry {
  eventId: string;
  dataHash: string;
  eventRowDigest: string;
  snapshotDigest: string;
  proofDigest: string | null;
  proofStatus: string | null;
  proofNetwork: string | null;
  proofChannelId: string | null;
  proofDataHash: string | null;
  outboxStatus: string | null;
}
export interface RouteInventory {
  protocol: 'agritrace-ledger-route-inventory/1';
  entries: RouteInventoryEntry[];
  digest: string;
}

/** Caller owns a read-only REPEATABLE READ snapshot, or the locked apply tx.
 * Hash inside PostgreSQL: JS Date truncation must not hide microsecond changes.
 * Only identifiers/digests/public destination/status leave this function. */
export async function inventoryLedgerRoutes(
  tx: Prisma.TransactionClient,
  eventIds: string[],
): Promise<RouteInventory> {
  if (
    !eventIds.length ||
    eventIds.length > 1000 ||
    new Set(eventIds).size !== eventIds.length ||
    eventIds.some(
      (id) => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id),
    )
  )
    throw new Error('Ledger route inventory requires 1..1000 unique event IDs');
  await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
  const entries = await tx.$queryRaw<RouteInventoryEntry[]>(Prisma.sql`
    SELECT e.event_id AS "eventId", e.data_hash AS "dataHash",
      encode(sha256(convert_to(to_jsonb(e)::text,'UTF8')),'hex') AS "eventRowDigest",
      encode(sha256(convert_to(jsonb_build_object('event',to_jsonb(e),'proof',to_jsonb(p),'outbox',to_jsonb(o))::text,'UTF8')),'hex') AS "snapshotDigest",
      CASE WHEN p.proof_id IS NULL THEN NULL ELSE encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex') END AS "proofDigest",
      p.transaction_status::text AS "proofStatus", p.network AS "proofNetwork", p.channel_id AS "proofChannelId", p.data_hash AS "proofDataHash",
      o.status::text AS "outboxStatus"
    FROM trace_event e LEFT JOIN blockchain_proof p USING(event_id) LEFT JOIN blockchain_outbox o USING(event_id)
    JOIN ledger_route_legacy_requirement r ON r.event_id=e.event_id AND r.data_hash=e.data_hash
    WHERE e.event_id IN (${Prisma.join(eventIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY e.event_id
  `);
  if (entries.length !== eventIds.length)
    throw new Error(
      'Ledger route inventory contains a missing or non-legacy event',
    );
  const body = {
    protocol: 'agritrace-ledger-route-inventory/1' as const,
    entries,
  };
  return { ...body, digest: canonicalSha256(body) };
}

function requireOperator(context: {
  environment: RouteEnvironment;
  sourceSha: string;
}) {
  if (
    process.env.LEDGER_ROUTE_IMPORT_ENABLED !== 'true' ||
    !/^[a-f0-9]{40}$/.test(context.sourceSha) ||
    !['production', 'isolated'].includes(context.environment) ||
    (process.env.NODE_ENV === 'production' &&
      context.environment !== 'production') ||
    (context.environment === 'isolated' &&
      (!process.env.TEST_DATABASE_URL ||
        process.env.HYBRID_DRAFT_TESTS !== '1'))
  )
    throw new Error('Ledger route operator gate is closed');
}

/** Trusted operator only; there is deliberately no HTTP command for this. */
export async function registerLedgerRouteDefinition(
  db: PrismaClient,
  route: PinnedRoute,
  context: { environment: RouteEnvironment; sourceSha: string },
) {
  requireOperator(context);
  assertPinnedLedgerRoute(route);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('agritrace-ledger-route-import/1',0))`;
    const previous = await tx.ledgerRouteDefinition.findUnique({
      where: { digest: route.digest },
    });
    if (previous) {
      assertPinnedLedgerRoute(previous);
      return { digest: route.digest, alreadyRegistered: true };
    }
    // Copy the payload explicitly: caller-supplied extra keys never enter storage.
    await tx.ledgerRouteDefinition.create({
      data: { ...routePayload(route), digest: route.digest },
    });
    return { digest: route.digest, alreadyRegistered: false };
  });
}

export async function applyLedgerRouteImport(
  db: PrismaClient,
  candidate: unknown,
  context: { environment: RouteEnvironment; sourceSha: string },
) {
  requireOperator(context);
  const artifact = validateRouteImportArtifact(candidate);
  const digest = canonicalSha256(artifact);
  if (
    artifact.sourceSha !== context.sourceSha ||
    artifact.environment !== context.environment
  )
    throw new Error('Ledger route import source/environment differs');
  verifiedRouteImportArtifact({
    digest,
    environment: artifact.environment,
    sourceSha: artifact.sourceSha,
    artifact,
  });
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout='5s'`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('agritrace-ledger-route-import/1',0))`;
      // SHARE ROW EXCLUSIVE blocks domain writes and claim UPDATEs. Inspect
      // leases only after both tables are locked; never clear/renew a lease here.
      await tx.$executeRaw`LOCK TABLE trace_event, blockchain_outbox, blockchain_proof, event_ledger_route, ledger_route_import, ledger_route_definition IN SHARE ROW EXCLUSIVE MODE`;
      const ids = artifact.entries.map((entry) => entry.eventId);
      const prior = await tx.ledgerRouteImport.findUnique({
        where: { digest },
      });
      const mappings = await tx.eventLedgerRoute.findMany({
        where: { eventId: { in: ids } },
      });
      const inventory = await inventoryLedgerRoutes(tx, ids);
      if (prior) {
        verifiedRouteImportArtifact(prior);
        if (
          mappings.length !== ids.length ||
          artifact.entries.some((entry) => {
            const mapping = mappings.find(
              (item) => item.eventId === entry.eventId,
            );
            const snapshot = inventory.entries.find(
              (item) => item.eventId === entry.eventId,
            );
            return (
              mapping?.importDigest !== digest ||
              mapping.definitionDigest !== entry.definitionDigest ||
              snapshot?.dataHash !== entry.dataHash ||
              snapshot.eventRowDigest !== entry.eventRowDigest
            );
          })
        )
          throw new Error(
            'Ledger route import has incomplete or conflicting applied provenance',
          );
        return { digest, imported: 0, alreadyApplied: ids.length };
      }
      if (mappings.length)
        throw new Error(
          'Ledger route import cannot replace applied provenance',
        );
      if (
        await tx.blockchainOutbox.findFirst({
          where: { status: 'PROCESSING' },
          select: { id: true },
        })
      )
        throw new Error(
          'Ledger route import requires reconciliation of PROCESSING leases',
        );
      if (inventory.digest !== artifact.inventoryDigest)
        throw new Error('Ledger route import inventory changed');
      const definitions = await tx.ledgerRouteDefinition.findMany({
        where: {
          digest: {
            in: [
              ...new Set(
                artifact.entries.map((entry) => entry.definitionDigest),
              ),
            ],
          },
        },
      });
      const routes = new Map(
        definitions.map((route) => [
          route.digest,
          assertPinnedLedgerRoute(route),
        ]),
      );
      const privateEvents = await tx.traceEvent.findMany({
        where: { id: { in: ids } },
      });
      for (const entry of artifact.entries) {
        const row = inventory.entries.find(
          (item) => item.eventId === entry.eventId,
        )!;
        const route = routes.get(entry.definitionDigest);
        if (
          !route ||
          row.dataHash !== entry.dataHash ||
          row.eventRowDigest !== entry.eventRowDigest ||
          row.snapshotDigest !== entry.snapshotDigest
        )
          throw new Error('Ledger route import snapshot/definition differs');
        if (entry.evidence.kind === 'PROOF') {
          if (
            row.proofStatus !== 'CONFIRMED' ||
            row.proofDigest !== entry.evidence.digest ||
            row.proofDataHash !== row.dataHash ||
            row.proofNetwork !== route.network ||
            row.proofChannelId !== route.channelId
          )
            throw new Error('Ledger route import confirmed proof differs');
        } else if (
          route.mode !== 'WRITE' ||
          !privateTraceEvidenceMatches(
            privateEvents.find((event) => event.id === entry.eventId)!,
          ) ||
          row.proofStatus === 'CONFIRMED' ||
          !['PENDING', 'RETRY'].includes(row.outboxStatus ?? '')
        )
          throw new Error('Ledger route import pending writer is unresolved');
      }
      await tx.ledgerRouteImport.create({
        data: {
          digest,
          sourceSha: artifact.sourceSha,
          environment: artifact.environment,
          artifact: artifact as unknown as Prisma.InputJsonObject,
        },
      });
      await appendInPredecessorOrder(tx, artifact, digest, routes);
      return { digest, imported: ids.length, alreadyApplied: 0 };
    },
    { timeout: 120000 },
  );
}

async function appendInPredecessorOrder(
  tx: Prisma.TransactionClient,
  artifact: RouteImportArtifact,
  digest: string,
  definitions: Map<string, PinnedRoute>,
) {
  const events = await tx.traceEvent.findMany({
    where: { id: { in: artifact.entries.map((entry) => entry.eventId) } },
  });
  const remaining = [...artifact.entries];
  while (remaining.length) {
    let appended = 0;
    // Appending removes entries; iterate a snapshot rather than skip siblings.
    for (const entry of remaining.slice()) {
      const event = events.find((item) => item.id === entry.eventId)!;
      if (event.previousEventHash) {
        const previous = await tx.traceEvent.findMany({
          where: {
            entityType: event.entityType,
            entityId: event.entityId,
            dataHash: event.previousEventHash,
          },
          include: { ledgerRoute: EVENT_LEDGER_ROUTE_INCLUDE },
          take: 2,
        });
        if (previous.length !== 1)
          throw new Error(
            'Ledger route predecessor is unresolved or ambiguous',
          );
        if (remaining.some((item) => item.eventId === previous[0].id)) continue;
        const predecessor = verifiedEventRoute(previous[0]);
        if (
          !predecessor ||
          !sameLedgerDestination(
            predecessor,
            definitions.get(entry.definitionDigest)!,
          )
        )
          throw new Error(
            'Ledger route predecessor destination/provenance is unresolved',
          );
      }
      await tx.eventLedgerRoute.create({
        data: {
          eventId: entry.eventId,
          definitionDigest: entry.definitionDigest,
          importDigest: digest,
        },
      });
      remaining.splice(
        remaining.findIndex((item) => item.eventId === entry.eventId),
        1,
      );
      appended++;
    }
    if (!appended)
      throw new Error(
        'Ledger route import has a cyclic predecessor dependency',
      );
  }
}
