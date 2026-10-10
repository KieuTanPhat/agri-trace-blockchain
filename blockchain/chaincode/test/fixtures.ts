import type { TraceEventEnvelope } from "../src/types";

export function validInput(
  overrides: Partial<TraceEventEnvelope> = {},
): TraceEventEnvelope {
  const eventId = overrides.eventId ?? "11111111-1111-4111-8111-111111111111";
  return {
    eventId,
    entityType: "PRODUCTION_CYCLE",
    entityId: "55555555-5555-4555-8555-555555555555",
    cycleId: "55555555-5555-4555-8555-555555555555",
    eventType: "PRODUCTION_CYCLE_CREATED",
    eventTime: "2026-09-09T00:00:00.000Z",
    dataHash: "a".repeat(64),
    schemaVersion: "2.0.0",
    canonicalizationVersion: "RFC8785",
    envelopeVersion: "3.0.0",
    nonce: eventId,
    ...overrides,
  };
}
