import { describe, expect, it } from "vitest";

import { parseTraceEventInput } from "../src/validation";
import { validInput } from "./fixtures";

describe("TraceEvent validation", () => {
  it("accepts the exact versioned input contract", () => {
    expect(parseTraceEventInput(JSON.stringify(validInput()))).toEqual(validInput());
  });

  it.each([
    ["malformed JSON", "{", "valid JSON"],
    ["array payload", "[]", "JSON object"],
    ["invalid eventId", JSON.stringify(validInput({ eventId: "event-1" })), "UUID"],
    ["invalid batchId", JSON.stringify(validInput({ batchId: "bad batch" })), "batchId"],
    ["unsupported event", JSON.stringify({ ...validInput(), eventType: "CARE_RECORDED" }), "UNSUPPORTED_EVENT_TYPE"],
    ["non-UTC time", JSON.stringify(validInput({ eventTime: "2026-09-09T07:00:00+07:00" })), "UTC RFC 3339"],
    ["impossible time", JSON.stringify(validInput({ eventTime: "not-a-time" })), "UTC RFC 3339"],
    ["uppercase hash", JSON.stringify(validInput({ dataHash: "A".repeat(64) })), "lowercase SHA-256"],
    ["wrong schema", JSON.stringify({ ...validInput(), schemaVersion: "2.0.0" }), "schemaVersion"],
    ["wrong canonicalizer", JSON.stringify({ ...validInput(), canonicalizationVersion: "JSON" }), "canonicalizationVersion"],
    ["unknown field", JSON.stringify({ ...validInput(), extra: true }), "Unknown field"]
  ])("rejects %s", (_name, payload, message) => {
    expect(() => parseTraceEventInput(payload)).toThrow(message);
  });

  it("rejects invalid actor and auth proof structures", () => {
    expect(() => parseTraceEventInput(JSON.stringify({ ...validInput(), actorContext: null }))).toThrow(
      "actorContext"
    );
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorContext: { ...validInput().actorContext, role: "SYSTEM_ADMIN" }
    }))).toThrow("FARM_STAFF");
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorContext: { ...validInput().actorContext, extra: true }
    }))).toThrow("actorContext fields");
    expect(() => parseTraceEventInput(JSON.stringify({ ...validInput(), actorAuthProof: null }))).toThrow(
      "actorAuthProof"
    );
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorAuthProof: { ...validInput().actorAuthProof, proofType: "JWT" }
    }))).toThrow("proofType");
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorAuthProof: { ...validInput().actorAuthProof, requestId: "" }
    }))).toThrow("requestId");
    expect(() => parseTraceEventInput(JSON.stringify({
      ...validInput(),
      actorAuthProof: { ...validInput().actorAuthProof, principalId: "44444444-4444-4444-8444-444444444444" }
    }))).toThrow("must match");
  });

  it("rejects oversized or sensitive metadata", () => {
    expect(() => parseTraceEventInput(JSON.stringify(validInput({ payloadMetadata: [] as never })))).toThrow(
      "payloadMetadata must be an object"
    );
    expect(() => parseTraceEventInput(JSON.stringify(validInput({
      payloadMetadata: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field${index}`, index]))
    })))).toThrow("too many properties");
    expect(() => parseTraceEventInput(JSON.stringify(validInput({ payloadMetadata: { note: "x".repeat(9_000) } })))).toThrow(
      "8 KiB"
    );
    expect(() => parseTraceEventInput(JSON.stringify(validInput({
      payloadMetadata: { nested: [{ rawReadings: [1, 2, 3] }] }
    })))).toThrow("forbidden key");
  });
});
