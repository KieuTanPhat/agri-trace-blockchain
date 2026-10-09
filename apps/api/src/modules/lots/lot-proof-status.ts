import { calculateTraceEventHash } from '../trace/public.js';

export type ProofEvent = Parameters<typeof calculateTraceEventHash>[0] & {
  dataHash: string;
  blockchainProof: null | { dataHash: string; transactionStatus: string };
  blockchainOutbox?: null | { status: string };
};

export function aggregateLotProofStatus(events: ProofEvent[]) {
  const statuses = events.map((event) => getLotEventProofStatus(event));
  for (const status of [
    'INTEGRITY_WARNING',
    'BLOCKCHAIN_UNAVAILABLE',
    'PENDING',
  ] as const) {
    if (statuses.includes(status)) return status;
  }
  return statuses.length ? 'VERIFIED' : 'PENDING';
}

export function getLotEventProofStatus(event?: ProofEvent) {
  if (event) {
    try {
      if (event.dataHash !== calculateTraceEventHash(event))
        return 'INTEGRITY_WARNING';
    } catch {
      return 'INTEGRITY_WARNING';
    }
  }
  if (!event?.blockchainProof) {
    return event?.blockchainOutbox?.status === 'DEAD_LETTER'
      ? 'BLOCKCHAIN_UNAVAILABLE'
      : 'PENDING';
  }
  if (event.blockchainProof.dataHash !== event.dataHash)
    return 'INTEGRITY_WARNING';
  if (event.blockchainOutbox?.status === 'DEAD_LETTER')
    return 'BLOCKCHAIN_UNAVAILABLE';
  if (event.blockchainProof.transactionStatus === 'CONFIRMED')
    return 'VERIFIED';
  if (event.blockchainProof.transactionStatus === 'FAILED')
    return 'BLOCKCHAIN_UNAVAILABLE';
  return 'PENDING';
}
