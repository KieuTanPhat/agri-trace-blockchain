import { describe, expect, it } from "vitest";

import { EVENT_TYPES } from "../src/types";
import { parseTraceEventInput } from "../src/validation";
import { validInput } from "./fixtures";

describe("TraceEvent validation", () => {
  const apiEventTypes = [
    "PRODUCTION_CYCLE_CREATED",
    "CYCLE_PLANTED",
    "CARE_RECORDED",
    "CYCLE_COMPLETED",
    "CYCLE_CANCELLED",
    "HARVEST_RECORDED",
    "SHIPMENT_CREATED",
    "SHIPMENT_STARTED",
    "SHIPMENT_ARRIVED",
    "SHIPMENT_RECEIVED",
    "SHIPMENT_REJECTED",
    "SHIPMENT_DAMAGE_RECORDED",
    "INSPECTION_RECORDED",
    "CERTIFICATE_SUBMITTED",
    "CERTIFICATE_APPROVED",
    "CERTIFICATE_REJECTED",
    "SENSOR_DIGEST_CREATED",
    "SENSOR_DIGEST_FINALIZED",
    "SHIPMENT_TELEMETRY_DIGEST_CREATED",
    "SHIPMENT_TELEMETRY_DIGEST_FINALIZED",
    "TRACKING_DEVICE_BOUND",
    "TRACKING_DEVICE_UNBOUND",
  ] as const;

  it("accepts the versioned entity-centric input contract", () => {
    expect(parseTraceEventInput(JSON.stringify(validInput()))).toEqual(
      validInput(),
    );
  });

  it("supports every event currently emitted by the API", () => {
    expect(EVENT_TYPES).toEqual(expect.arrayContaining(apiEventTypes));
  });

  it.each([
    [
      "SENSOR_DIGEST",
      { cycleId: "55555555-5555-4555-8555-555555555555", lotId: undefined },
    ],
    [
      "SHIPMENT_TELEMETRY",
      { cycleId: undefined, lotId: "77777777-7777-4777-8777-777777777777" },
    ],
  ] as const)(
    "accepts the %s entity context emitted by the API",
    (entityType, context) => {
      const input = validInput({ entityType, ...context });
      expect(parseTraceEventInput(JSON.stringify(input))).toEqual(input);
    },
  );

  it.each([
    ["malformed JSON", "{", "valid JSON"],
    ["array payload", "[]", "JSON object"],
    [
      "invalid eventId",
      JSON.stringify(validInput({ eventId: "event-1" })),
      "UUID",
    ],
    [
      "invalid entityId",
      JSON.stringify(validInput({ entityId: "cycle-1" })),
      "entityId",
    ],
    [
      "unsupported entity",
      JSON.stringify({ ...validInput(), entityType: "BATCH" }),
      "entityType",
    ],
    [
      "unsupported event",
      JSON.stringify({ ...validInput(), eventType: "BATCH_CREATED" }),
      "eventType",
    ],
    [
      "missing cycle",
      JSON.stringify({ ...validInput(), cycleId: undefined }),
      "requires cycleId",
    ],
    [
      "non-UTC time",
      JSON.stringify(validInput({ eventTime: "2026-09-09T07:00:00+07:00" })),
      "UTC RFC 3339",
    ],
    [
      "uppercase hash",
      JSON.stringify(validInput({ dataHash: "A".repeat(64) })),
      "lowercase SHA-256",
    ],
    [
      "wrong schema",
      JSON.stringify({ ...validInput(), schemaVersion: "1.0.0" }),
      "schemaVersion",
    ],
    [
      "wrong canonicalizer",
      JSON.stringify({ ...validInput(), canonicalizationVersion: "JSON" }),
      "canonicalizationVersion",
    ],
    [
      "unknown field",
      JSON.stringify({ ...validInput(), extra: true }),
      "Unknown field",
    ],
    [
      "missing nonce",
      JSON.stringify({ ...validInput(), nonce: undefined }),
      "nonce",
    ],
    [
      "changed nonce",
      JSON.stringify(
        validInput({ nonce: "22222222-2222-4222-8222-222222222222" }),
      ),
      "nonce must equal",
    ],
    [
      "old envelope",
      JSON.stringify({ ...validInput(), envelopeVersion: "2.0.0" }),
      "envelopeVersion",
    ],
    [
      "uppercase UUID",
      JSON.stringify(
        validInput({ entityId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }),
      ),
      "canonical lowercase",
    ],
    [
      "invalid optional UUID",
      JSON.stringify(validInput({ lotId: "lot-1" })),
      "lotId",
    ],
    [
      "invalid predecessor hash",
      JSON.stringify(validInput({ previousEventHash: "bad" })),
      "previousEventHash",
    ],
    [
      "impossible calendar date",
      JSON.stringify(validInput({ eventTime: "2026-02-30T00:00:00.000Z" })),
      "real timestamp",
    ],
    [
      "missing Lot context",
      JSON.stringify(validInput({ entityType: "LOT", cycleId: undefined })),
      "requires lotId",
    ],
    [
      "missing certificate context",
      JSON.stringify(
        validInput({ entityType: "CERTIFICATE", cycleId: undefined }),
      ),
      "requires cycleId or lotId",
    ],
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseTraceEventInput(payload)).toThrow(message);
  });

  it.each([
    "actorContext",
    "actorAuthProof",
    "actorUserId",
    "payloadMetadata",
    "token",
    "rawReadings",
  ])(
    "rejects private %s rather than persisting it on the public ledger",
    (field) => {
      expect(() =>
        parseTraceEventInput(
          JSON.stringify({
            ...validInput(),
            [field]: { secret: "private-fixture" },
          }),
        ),
      ).toThrow(`Unknown field: ${field}`);
    },
  );

  it.each([
    { entityType: "CERTIFICATE" as const },
    {
      entityType: "CERTIFICATE" as const,
      cycleId: undefined,
      lotId: "77777777-7777-4777-8777-777777777777",
    },
    {
      entityType: "LOT" as const,
      lotId: "77777777-7777-4777-8777-777777777777",
    },
  ])("accepts valid certificate and Lot references", (context) => {
    const input = validInput(context);
    expect(parseTraceEventInput(JSON.stringify(input))).toEqual(input);
  });
});
