import type { TraceEventInput } from "../src/types";

export function validInput(overrides: Partial<TraceEventInput> = {}): TraceEventInput {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    entityType: "PRODUCTION_CYCLE",
    entityId: "55555555-5555-4555-8555-555555555555",
    cycleId: "55555555-5555-4555-8555-555555555555",
    eventType: "PRODUCTION_CYCLE_CREATED",
    eventTime: "2026-09-09T00:00:00.000Z",
    dataHash: "a".repeat(64),
    schemaVersion: "2.0.0",
    canonicalizationVersion: "RFC8785",
    actorContext: {
      actorUserId: "22222222-2222-4222-8222-222222222222",
      role: "FARM_STAFF",
      organizationId: "33333333-3333-4333-8333-333333333333",
      authProofType: "TOKEN_FINGERPRINT",
      actorAuthProof: "b".repeat(64)
    },
    payloadMetadata: {
      productType: "coffee",
      variety: "Robusta"
    },
    ...overrides
  };
}
