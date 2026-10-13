import { calculateTraceEventHash } from '../trace/public.js';
import {
  privateTraceEvidenceMatches,
  type EventBindingEvidence,
} from '../trace/trace-evidence.js';
import { routeProofMatches, type RoutedEvent } from '../trace/ledger-route.js';

export type ProofEvent = Parameters<typeof calculateTraceEventHash>[0] &
  RoutedEvent & {
    dataHash: string;
    blockchainProof: null | {
      dataHash: string;
      transactionStatus: string;
      eventId?: string;
      txId?: string | null;
      channelId?: string;
      network?: string;
      recordedAt?: Date | null;
    };
    blockchainOutbox?: null | { status: string };
    bindingContext?: EventBindingEvidence;
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
    if (!privateTraceEvidenceMatches(event)) return 'INTEGRITY_WARNING';
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
  if (event.blockchainProof.transactionStatus === 'CONFIRMED') {
    const proof = event.blockchainProof;
    if (
      proof.eventId !== event.id ||
      !proof.txId ||
      !/^[a-f0-9]{64}$/.test(proof.txId) ||
      !routeProofMatches(event, proof) ||
      !proof.recordedAt ||
      !Number.isFinite(proof.recordedAt.getTime())
    )
      return 'INTEGRITY_WARNING';
    return 'VERIFIED';
  }
  if (event.blockchainProof.transactionStatus === 'FAILED')
    return 'BLOCKCHAIN_UNAVAILABLE';
  return 'PENDING';
}
