import {
  bindingEventCommitment,
  privateBodyDigest,
  B_SCHEMA_VERSION,
} from '../../src/modules/trace/binding-commitment.js';
import type { TraceHashInput } from '../../src/modules/trace/trace-hash.js';
import { fixtureRoute } from './ledger-route-fixture.js';

const PERMISSION_REF = '6f0c1f43-6c84-4c2c-9f3b-1d7c3a5e2b10';

/** Commit a private V2 row as a B event on the fixture binding, the way
 * TraceService does. Synthetic: not Fabric acceptance evidence. */
export function bindingEvent<T extends TraceHashInput>(input: T, ordinal = 1) {
  const bodyDigest = privateBodyDigest(input);
  const permissions = [
    { permissionRef: PERMISSION_REF, epoch: 1, ordinal: BigInt(ordinal) },
  ];
  const dataHash = bindingEventCommitment(
    {
      eventId: input.id,
      entityType: input.entityType,
      entityId: input.entityId,
      cycleId: input.cycleId ?? null,
      lotId: input.lotId ?? null,
      eventType: input.eventType,
      eventTime: input.eventTime,
      previousEventHash: input.previousEventHash ?? null,
      bindingDigest: fixtureRoute.bindingDigest!,
      chainRef: fixtureRoute.chainRef!,
      permissions: permissions.map((item) => ({
        permissionRef: item.permissionRef,
        epoch: String(item.epoch),
        ordinal: String(item.ordinal),
      })),
    },
    bodyDigest,
  );
  return {
    ...input,
    schemaVersion: B_SCHEMA_VERSION,
    dataHash,
    ledgerRoute: { definitionDigest: fixtureRoute.digest, definition: fixtureRoute },
    bindingContext: {
      bindingDigest: fixtureRoute.bindingDigest!,
      privateBodyDigest: bodyDigest,
      commitmentVersion: 'b1',
      binding: { chainRef: fixtureRoute.chainRef!, digest: fixtureRoute.bindingDigest! },
      permissions,
      event: { actorSignature: null },
    },
  };
}
