import type { TraceEventInput } from "../src/types";

export function validInput(overrides: Partial<TraceEventInput> = {}): TraceEventInput {
  return {
    eventId: "11111111-1111-4111-8111-111111111111",
    batchId: "BATCH-2026-0001",
    eventType: "BATCH_CREATED",
    eventTime: "2026-09-09T00:00:00.000Z",
    dataHash: "a".repeat(64),
    schemaVersion: "1.0.0",
    canonicalizationVersion: "RFC8785",
    actorContext: {
      actorId: "22222222-2222-4222-8222-222222222222",
      role: "FARM_STAFF",
      organizationId: "33333333-3333-4333-8333-333333333333"
    },
    actorAuthProof: {
      proofType: "BACKEND_AUTH_CONTEXT",
      principalId: "22222222-2222-4222-8222-222222222222",
      authenticatedAt: "2026-09-09T00:00:00.000Z",
      requestId: "req-0001",
      proofHash: "b".repeat(64)
    },
    payloadMetadata: {
      productType: "coffee",
      variety: "Robusta"
    },
    ...overrides
  };
}
