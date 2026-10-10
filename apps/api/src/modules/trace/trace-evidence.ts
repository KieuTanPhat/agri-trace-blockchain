import { calculateTraceEventHash, type TraceHashInput } from './trace-hash.js';

export function privateTraceEvidenceMatches(
  event: TraceHashInput & { dataHash: string },
): boolean {
  try {
    return (
      event.schemaVersion === '2.0.0' &&
      event.canonicalizationVersion === 'RFC8785' &&
      !!event.authProofType &&
      [
        'DIGITAL_SIGNATURE',
        'SIGNED_ASSERTION',
        'TOKEN_FINGERPRINT',
        'DEVICE_SIGNATURE',
        'SYSTEM_ASSERTION',
      ].includes(event.authProofType) &&
      !!event.actorAuthProof &&
      /^[a-f0-9]{64}$/.test(event.actorAuthProof) &&
      (!!event.actorUserId ||
        ['IOT_DEVICE', 'SYSTEM_ACTOR', 'RELAYER_SERVICE'].includes(
          event.actorRole,
        )) &&
      event.dataHash === calculateTraceEventHash(event)
    );
  } catch {
    return false;
  }
}
