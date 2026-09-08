import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import { describe, expect, it } from "vitest";

describe("RFC 8785 and SHA-256 vectors", () => {
  it("produces the same digest regardless of object property insertion order", () => {
    const left = { batchId: "BATCH-1", quantity: 120.5, nested: { z: true, a: "cà phê" } };
    const right = { nested: { a: "cà phê", z: true }, quantity: 120.5, batchId: "BATCH-1" };
    const canonicalLeft = canonicalize(left);
    const canonicalRight = canonicalize(right);

    expect(canonicalLeft).toBe(canonicalRight);
    expect(createHash("sha256").update(canonicalLeft!, "utf8").digest("hex")).toBe(
      "cc14c679185dea21522b06bfe2e0e5993efdeec197cad31d684219dab3f9749f"
    );
  });

  it("matches the RFC 8785 property-ordering example", () => {
    const value = {
      "\u20ac": "Euro Sign",
      "\r": "Carriage Return",
      "\ufb33": "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      "😀": "Emoji: Grinning Face",
      "\u0080": "Control",
      "ö": "Latin Small Letter O With Diaeresis"
    };
    expect(canonicalize(value)).toBe(
      "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}"
    );
  });
});
