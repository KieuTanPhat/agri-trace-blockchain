import { describe, expect, it } from "vitest";

import { EVENT_TYPES } from "../src/types";
import { parseTraceEventInput } from "../src/validation";
import { validInput } from "./fixtures";

describe("TraceEvent validation", () => {
  const apiEventTypes = [
    "PRODUCTION_CYCLE_CREATED", "CYCLE_PLANTED", "CARE_RECORDED",
    "CYCLE_COMPLETED", "CYCLE_CANCELLED", "HARVEST_RECORDED",
    "SHIPMENT_CREATED", "SHIPMENT_STARTED", "SHIPMENT_ARRIVED",
    "SHIPMENT_RECEIVED", "SHIPMENT_REJECTED", "SHIPMENT_DAMAGE_RECORDED",
    "INSPECTION_RECORDED", "CERTIFICATE_SUBMITTED", "CERTIFICATE_APPROVED",
    "CERTIFICATE_REJECTED", "SENSOR_DIGEST_CREATED", "SENSOR_DIGEST_FINALIZED",
    "SHIPMENT_TELEMETRY_DIGEST_CREATED", "SHIPMENT_TELEMETRY_DIGEST_FINALIZED",
    "TRACKING_DEVICE_BOUND", "TRACKING_DEVICE_UNBOUND"
  ] as const;

  it("accepts the versioned entity-centric input contract", () => {
    expect(parseTraceEventInput(JSON.stringify(validInput()))).toEqual(validInput());
  });

  it("supports every event currently emitted by the API", () => {
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(apiEventTypes));
  });

  it.each([
    ["SENSOR_DIGEST", { cycleId: "55555555-5555-4555-8555-555555555555", lotId: undefined }],
    ["SHIPMENT_TELEMETRY", { cycleId: undefined, lotId: "77777777-7777-4777-8777-777777777777" }]
  ] as const)("accepts the %s entity context emitted by the API", (entityType, context) => {
    const input = validInput({ entityType, ...context });
    expect(parseTraceEventInput(JSON.stringify(input))).toEqual(input);
  });

  it.each([
    ["malformed JSON", "{", "valid JSON"],
    ["array payload", "[]", "JSON object"],
    ["invalid eventId", JSON.stringify(validInput({ eventId: "event-1" })), "UUID"],
    ["invalid entityId", JSON.stringify(validInput({ entityId: "cycle-1" })), "entityId"],
    ["unsupported entity", JSON.stringify({ ...validInput(), entityType: "BATCH" }), "entityType"],
    ["unsupported event", JSON.stringify({ ...validInput(), eventType: "BATCH_CREATED" }), "eventType"],
    ["missing cycle", JSON.stringify({ ...validInput(), cycleId: undefined }), "requires cycleId"],
    ["non-UTC time", JSON.stringify(validInput({ eventTime: "2026-09-09T07:00:00+07:00" })), "UTC RFC 3339"],
    ["uppercase hash", JSON.stringify(validInput({ dataHash: "A".repeat(64) })), "lowercase SHA-256"],
    ["wrong schema", JSON.stringify({ ...validInput(), schemaVersion: "1.0.0" }), "schemaVersion"],
    ["wrong canonicalizer", JSON.stringify({ ...validInput(), canonicalizationVersion: "JSON" }), "canonicalizationVersion"],
    ["unknown field", JSON.stringify({ ...validInput(), extra: true }), "Unknown field"]
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseTraceEventInput(payload)).toThrow(message);
  });

  it("requires user identity for user-triggered events", () => {
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorContext: { ...validInput().actorContext, actorUserId: undefined }
    }))).toThrow("actorUserId");
  });

  it("accepts a system actor without a user id", () => {
    const input = validInput({
      actorContext: {
        role: "SYSTEM_ACTOR",
        authProofType: "SYSTEM_ASSERTION",
        actorAuthProof: "c".repeat(64)
      }
    });
    expect(parseTraceEventInput(JSON.stringify(input))).toEqual(input);
  });

  it("rejects oversized or sensitive metadata", () => {
    expect(() => parseTraceEventInput(JSON.stringify(validInput({ payloadMetadata: [] as never })))).toThrow("object");
    expect(() => parseTraceEventInput(JSON.stringify(validInput({
      payloadMetadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index}`, index]))
    })))).toThrow("too many");
    expect(() => parseTraceEventInput(JSON.stringify(validInput({
      payloadMetadata: { nested: [{ rawReadings: [1, 2, 3] }] }
    })))).toThrow("forbidden key");
  });
});
