import { canonicalize } from 'json-canonicalize';
import {
  bindingEventCommitment,
  privateBodyDigest,
  B_SCHEMA_VERSION,
  type PermissionRef,
} from './binding-commitment.js';
import {
  assertionDigest,
  C_SCHEMA_VERSION,
  LEGACY_C_SCHEMA_VERSION,
  INTENT_PROTOCOL,
  LEGACY_INTENT_PROTOCOL,
  intentDigest,
  payloadDigest,
  signedBindingEventCommitment,
  signedMessageForIntent,
  signedBusinessPayload,
  signedMetadataDigest,
  signedPrivateBodyDigest,
  verifyEd25519,
  type IntentBody,
  type IntentPayload,
} from './signed-commitment.js';
import { calculateTraceEventHash, type TraceHashInput } from './trace-hash.js';

export function publicBlockchainDeliveryError(
  diagnostic: string | null | undefined,
): string | null {
  return diagnostic
    ? 'Blockchain delivery failed; contact support with eventId'
    : null;
}

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
  /** Release C: signature sidecar of the same event. */
  event?: {
    actorSignature: {
      keyRef: string;
      intentDigest: string;
      assertionDigest: string;
      signature: string;
      algorithm: string;
      key: { publicKey: string; organizationId: string };
    } | null;
  } | null;
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
    if (
      [C_SCHEMA_VERSION, LEGACY_C_SCHEMA_VERSION].includes(event.schemaVersion)
    )
      return signedEvidenceMatches(event);
    return false;
  } catch {
    return false;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Release C: the private row hashes to the recorded digest, the embedded
 * intent is exactly what was signed, the signature verifies against the
 * registered key, and the public commitment (dataHash) covers all of it. */
function signedEvidenceMatches(event: EvidenceEvent): boolean {
  const context = event.bindingContext;
  const stored = context?.event?.actorSignature;
  const c2 = event.schemaVersion === C_SCHEMA_VERSION;
  if (!context || !stored || context.commitmentVersion !== (c2 ? 'c2' : 'c1'))
    return false;
  const data = event.businessData;
  if (!isRecord(data) || !isRecord(data.actorSignature)) return false;
  const embedded = data.actorSignature;
  if (
    Object.keys(embedded).sort().join(',') !==
    'assertion,intent,payload,signerOrgId'
  )
    return false;
  if (!isRecord(embedded.intent) || !isRecord(embedded.payload)) return false;
  const intent = embedded.intent as unknown as IntentBody;
  const payload = embedded.payload as IntentPayload;
  const assertion = {
    algorithm: 'Ed25519' as const,
    keyRef: stored.keyRef,
    intentDigest: stored.intentDigest,
    signature: stored.signature,
    ...(c2 ? { payloadDigest: intent.payloadDigest } : {}),
  };
  // 1. The embedded intent is the one that was digested and signed, and it
  //    names this very event, entity, chain, binding and key.
  if (
    stored.algorithm !== 'Ed25519' ||
    intent.protocol !== (c2 ? INTENT_PROTOCOL : LEGACY_INTENT_PROTOCOL) ||
    intentDigest(intent) !== stored.intentDigest ||
    payloadDigest(payload, intent.protocol) !== intent.payloadDigest ||
    canonicalize(signedBusinessPayload(data)) !== canonicalize(payload) ||
    canonicalize(embedded.assertion) !== canonicalize(assertion) ||
    embedded.signerOrgId !== stored.key.organizationId ||
    event.actorOrganizationId !== stored.key.organizationId ||
    assertionDigest(assertion) !== stored.assertionDigest ||
    intent.eventId !== event.id ||
    intent.entityType !== event.entityType ||
    intent.entityId !== event.entityId ||
    intent.eventType !== event.eventType ||
    intent.bindingDigest !== context.bindingDigest ||
    intent.chainRef !== context.binding.chainRef ||
    intent.keyRef !== stored.keyRef ||
    intent.signerOrgRef !== stored.key.organizationId
  )
    return false;
  const content = c2
    ? {
        payloadDigest: intent.payloadDigest,
        metadataDigest: signedMetadataDigest(event),
        assertionDigest: stored.assertionDigest,
      }
    : null;
  if (
    (content ? signedPrivateBodyDigest(content) : privateBodyDigest(event)) !==
    context.privateBodyDigest
  )
    return false;
  // 2. The signature verifies for the registered key over that exact intent.
  if (
    !verifyEd25519(
      stored.key.publicKey,
      signedMessageForIntent(intent),
      stored.signature,
    )
  )
    return false;
  // 3. The public commitment binds the body digest, context and assertion.
  const permissions: PermissionRef[] = context.permissions.map((item) => ({
    permissionRef: item.permissionRef,
    epoch: String(item.epoch),
    ordinal: String(item.ordinal),
  }));
  return (
    signedBindingEventCommitment(
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
      {
        keyRef: stored.keyRef,
        intentDigest: stored.intentDigest,
        assertionDigest: assertionDigest(assertion),
        ...content,
      },
    ) === event.dataHash
  );
}
