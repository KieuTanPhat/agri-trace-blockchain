import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export interface TraceHashInput {
  id: string;
  entityType: string;
  entityId: string;
  cycleId: string | null;
  lotId: string | null;
  eventType: string;
  eventTime: Date;
  actorUserId: string | null;
  actorOrganizationId: string | null;
  actorRole: string;
  authProofType: string | null;
  actorAuthProof: string | null;
  businessData: unknown;
  previousEventHash: string | null;
  schemaVersion: string;
  canonicalizationVersion: string;
}

export function calculateTraceEventHash(event: TraceHashInput): string {
  return canonicalSha256({
    eventId: event.id,
    entityType: event.entityType,
    entityId: event.entityId,
    cycleId: event.cycleId,
    lotId: event.lotId,
    eventType: event.eventType,
    eventTime: event.eventTime.toISOString(),
    actorContext: {
      actorUserId: event.actorUserId,
      organizationId: event.actorOrganizationId,
      role: event.actorRole,
      authProofType: event.authProofType,
      actorAuthProof: event.actorAuthProof,
    },
    businessData: event.businessData,
    previousEventHash: event.previousEventHash,
    schemaVersion: event.schemaVersion,
    canonicalizationVersion: event.canonicalizationVersion,
  });
}
