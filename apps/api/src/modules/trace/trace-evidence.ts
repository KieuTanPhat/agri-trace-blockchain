import {
  bindingEventCommitment,
  privateBodyDigest,
  B_SCHEMA_VERSION,
  type PermissionRef,
} from './binding-commitment.js';
import { calculateTraceEventHash, type TraceHashInput } from './trace-hash.js';

const AUTH_PROOF_TYPES = [
  'DIGITAL_SIGNATURE',
  'SIGNED_ASSERTION',
  'TOKEN_FINGERPRINT',
  'DEVICE_SIGNATURE',
  'SYSTEM_ASSERTION',
];

/** Release B context loaded with the event (binding, captured epochs). */
export type EventBindingEvidence = {
  bindingDigest: string;
  privateBodyDigest: string;
  commitmentVersion: string;
  binding: { chainRef: string; digest: string };
  permissions: Array<{
    permissionRef: string;
    epoch: number;
    ordinal: bigint | number | string;
  }>;
} | null;

export type EvidenceEvent = TraceHashInput & {
  dataHash: string;
  bindingContext?: EventBindingEvidence;
};

function actorEvidenceValid(event: TraceHashInput): boolean {
  return (
    !!event.authProofType &&
    AUTH_PROOF_TYPES.includes(event.authProofType) &&
    !!event.actorAuthProof &&
    // Release A/B evidence is a technical fingerprint; a real signature is
    // never accepted through this field (release C uses its own versions).
    /^[a-f0-9]{64}$/.test(event.actorAuthProof) &&
    (!!event.actorUserId ||
      ['IOT_DEVICE', 'SYSTEM_ACTOR', 'RELAYER_SERVICE'].includes(
        event.actorRole,
      ))
  );
}

/** Version-dispatched evidence check. Unknown versions fail closed. */
export function privateTraceEvidenceMatches(event: EvidenceEvent): boolean {
  try {
    if (
      event.canonicalizationVersion !== 'RFC8785' ||
      !actorEvidenceValid(event)
    )
      return false;
    if (event.schemaVersion === '2.0.0')
      return event.dataHash === calculateTraceEventHash(event);
    if (event.schemaVersion === B_SCHEMA_VERSION) {
      const context = event.bindingContext;
      if (!context || context.commitmentVersion !== 'b1') return false;
      // 1. The private row still hashes to the digest recorded at write time.
      if (privateBodyDigest(event) !== context.privateBodyDigest) return false;
      // 2. The public commitment over the immutable context is the dataHash.
      const permissions: PermissionRef[] = context.permissions.map((item) => ({
        permissionRef: item.permissionRef,
        epoch: String(item.epoch),
        ordinal: String(item.ordinal),
      }));
      return (
        bindingEventCommitment(
          {
            eventId: event.id,
            entityType: event.entityType,
            entityId: event.entityId,
            cycleId: event.cycleId,
            lotId: event.lotId,
            eventType: event.eventType,
            eventTime: event.eventTime,
            previousEventHash: event.previousEventHash,
            bindingDigest: context.bindingDigest,
            chainRef: context.binding.chainRef,
            permissions,
          },
          context.privateBodyDigest,
        ) === event.dataHash
      );
    }
    return false;
  } catch {
    return false;
  }
}
