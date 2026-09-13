import { describe, expect, it } from "vitest";

import { fromLedgerBytes, timestampToIso, toLedgerBytes } from "../src/ledger";

describe("ledger helpers", () => {
  it("canonicalizes state before writing and parses it back", () => {
    const bytes = toLedgerBytes({ z: 1, a: 2 });
    expect(bytes.toString("utf8")).toBe('{"a":2,"z":1}');
    expect(fromLedgerBytes(bytes, "value")).toEqual({ a: 2, z: 1 });
  });

  it("rejects values that cannot be canonicalized", () => {
    expect(() => toLedgerBytes(undefined)).toThrow("INVALID_INPUT");
  });

  it("rejects empty ledger records", () => {
    expect(() => fromLedgerBytes(new Uint8Array(), "thing")).toThrow("NOT_FOUND");
  });

  it("converts numeric and Long-like Fabric timestamps", () => {
    expect(timestampToIso({ seconds: 0, nanos: 999_000_000 })).toBe("1970-01-01T00:00:00.999Z");
    expect(timestampToIso({ seconds: { toString: () => "1" }, nanos: 0 })).toBe("1970-01-01T00:00:01.000Z");
  });

  it("rejects an invalid Fabric timestamp", () => {
    expect(() => timestampToIso({ seconds: Number.POSITIVE_INFINITY, nanos: 0 })).toThrow("INVALID_INPUT");
  });
});
