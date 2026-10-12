import type { Prisma } from '../../generated/prisma/client.js';
import type { AuthorizedCommand } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { businessRoot } from './business-policy.js';

/** Resolve an old creation only from its immutable positive journal. The
 * request must retain the original key and payload hash. This never permits
 * a fresh direct Shipment or an unscoped Cycle after organization cutover. */
export async function legacyCreationReplayRoot(
  db: Prisma.TransactionClient,
  input: AuthorizedCommand,
) {
  if (
    !input.idempotencyKey ||
    !input.actor ||
    !['CREATE_PRODUCTION_CYCLE', 'CREATE_SHIPMENT'].includes(input.operation)
  )
    return null;
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
  const journal = record?.commandCommit;
  if (
    !record ||
    !journal ||
    record.requestHash !== canonicalSha256(input.payload) ||
    journal.requesterId !== input.requesterId ||
    journal.operation !== input.operation ||
    journal.authorizationScope !== record.authorizationScope
  )
    return null;
  const original = journal.actorScope as Record<string, unknown>;
  if (
    original.role !== 'FARM_STAFF' ||
    original.organizationId !== input.actor.organizationId ||
    journal.authorizationScope !==
      canonicalSha256({
        requesterId: input.requesterId,
        role: original.role,
        organizationId: original.organizationId,
      })
  )
    return null;
  const resources = journal.resourceIds as { result?: Record<string, string> };
  const created = resources.result?.id;
  if (!created) return null;
  const root = await businessRoot(db, {
    kind: input.operation === 'CREATE_PRODUCTION_CYCLE' ? 'cycle' : 'shipment',
    id: created,
  });
  const mapping = await db.legacyScopeMapping.findUnique({
    where: { cycleId: root.cycle.id },
  });
  if (!mapping?.chainId) return null;
  return root;
}
