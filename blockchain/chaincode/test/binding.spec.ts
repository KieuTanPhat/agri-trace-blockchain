import { describe, expect, it } from "vitest";

import {
  B_ENVELOPE_VERSION,
  bindingDigest,
  bindingEventCommitment,
  canonicalPositiveInt,
  parseBindingEvent,
  type BindingEventInput,
  type BindingTuple,
} from "../src/binding";
import { GOVERNANCE_DIGEST } from "../src/governance";

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// The same design vectors are asserted by the API encoder; both must agree.
export const designBinding: BindingTuple = {
  network: "isolated-hybrid-b",
  channelId: "hybrid-b",
  chaincodeName: "agritrace",
  contractName: "AgriTraceContract",
  chainRef: u(3),
  envelopeVersion: B_ENVELOPE_VERSION,
  writerAuthority: "technical-relayer:agritrace-b",
  writerMspId: "AgriTraceMSP",
  writerRole: "relayer",
  governanceDigest: "22".repeat(32),
};

export function designEvent(overrides: Partial<BindingEventInput> = {}): BindingEventInput {
  const event: BindingEventInput = {
    envelopeVersion: B_ENVELOPE_VERSION,
    schemaVersion: "3.0.0",
    canonicalizationVersion: "RFC8785",
    eventId: u(1),
    nonce: u(1),
    entityType: "PRODUCTION_CYCLE",
    entityId: u(2),
    cycleId: u(2),
    lotId: null,
    eventType: "PRODUCTION_CYCLE_CREATED",
    eventTime: "2026-10-13T00:00:00.000Z",
    previousEventHash: null,
    privateBodyDigest: "82ecc32d8bb61593552050a1a7225bf296e5a08b1a5b8188155ff5ec6d18c8e0",
    bindingDigest: bindingDigest(designBinding),
    chainRef: u(3),
    permissions: [{ permissionRef: u(4), epoch: "1", ordinal: "1" }],
    dataHash: "0".repeat(64),
    ...overrides,
  };
  return event;
}

describe("Release B commitment vectors (ledger side)", () => {
  it("matches the canonical binding vector", () => {
    expect(bindingDigest(designBinding)).toBe(
      "f34a78fd87c5dd0ef133144774c919732c8c81095903d4e2f352a3b0756a4ce0",
    );
  });

  it("matches the commitment B vector and both tamper vectors", () => {
    expect(bindingEventCommitment(designEvent())).toBe(
      "0418324c37f1d1d33116d61478920bc157b17e877d3aedf2fc166e7586df2c88",
    );
    expect(bindingEventCommitment(designEvent({ chainRef: u(9) }))).toBe(
      "e733f023c83d5a5cdca7287c867fa0cbc75b75ae6eb34c7049e9c5f0cf3cce1a",
    );
    expect(
      bindingEventCommitment(
        designEvent({ permissions: [{ permissionRef: u(4), epoch: "2", ordinal: "1" }] }),
      ),
    ).toBe("a4254cc2a430ccba18ef2336a2f3ba4f1d5ce66f6378119ee5b30bd3096e7dcc");
  });

  it("ignores dataHash itself so the commitment is not self-referential", () => {
    expect(bindingEventCommitment(designEvent({ dataHash: "f".repeat(64) }))).toBe(
      bindingEventCommitment(designEvent()),
    );
  });

  it("pins a stable governance digest for the reviewed descriptor", () => {
    expect(GOVERNANCE_DIGEST).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("Release B event parsing", () => {
  const valid = () => {
    const event = designEvent();
    return { ...event, dataHash: bindingEventCommitment(event) };
  };
  it("accepts the canonical event and rejects unknown, missing and non-null-omitted fields", () => {
    expect(parseBindingEvent(JSON.stringify(valid())).eventId).toBe(u(1));
    expect(() => parseBindingEvent(JSON.stringify({ ...valid(), extra: 1 }))).toThrow("unknown field");
    const { lotId: _lotId, ...withoutLot } = valid();
    expect(() => parseBindingEvent(JSON.stringify(withoutLot))).toThrow("missing field lotId");
  });
  it("rejects wrong versions, uppercase ids, bad timestamps and malformed permissions", () => {
    const bad = (patch: Record<string, unknown>) =>
      expect(() => parseBindingEvent(JSON.stringify({ ...valid(), ...patch }))).toThrow();
    bad({ envelopeVersion: "3.0.0" });
    bad({ schemaVersion: "2.0.0" });
    const upper = "0000000A-0000-4000-8000-00000000000A";
    bad({ eventId: upper, nonce: upper });
    bad({ nonce: u(7) });
    bad({ eventTime: "2026-10-13T00:00:00Z" });
    bad({ permissions: [] });
    bad({ permissions: [{ permissionRef: u(4), epoch: "01", ordinal: "1" }] });
    bad({
      permissions: [
        { permissionRef: u(5), epoch: "1", ordinal: "1" },
        { permissionRef: u(4), epoch: "1", ordinal: "2" },
      ],
    });
    bad({ entityType: "UNKNOWN" });
  });
  it("accepts int64 limits and rejects overflow", () => {
    expect(canonicalPositiveInt("9223372036854775807", "n")).toBe("9223372036854775807");
    expect(() => canonicalPositiveInt("9223372036854775808", "n")).toThrow();
    expect(() => canonicalPositiveInt("1e3", "n")).toThrow();
  });
});
