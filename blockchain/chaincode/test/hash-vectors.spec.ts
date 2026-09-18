import { createHash } from "node:crypto";

import { canonicalize } from "json-canonicalize";
import { describe, expect, it } from "vitest";

describe("RFC 8785 and SHA-256 vectors", () => {
  it("produces the same digest regardless of object property insertion order", () => {
    const left = { lotId: "LOT-1", quantity: 120.5, nested: { z: true, a: "cà phê" } };
    const right = { nested: { a: "cà phê", z: true }, quantity: 120.5, lotId: "LOT-1" };
    const canonicalLeft = canonicalize(left);
    const canonicalRight = canonicalize(right);

    expect(canonicalLeft).toBe(canonicalRight);
    expect(createHash("sha256").update(canonicalLeft!, "utf8").digest("hex")).toBe(
      "c0031306b3cabea4e520cc7b91fb048e7a56a2604e94f63f17e6ff3f31fac0d7"
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
