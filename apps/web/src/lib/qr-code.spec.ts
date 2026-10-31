import { describe, expect, it } from "vitest";
import { createQrMatrix, createQrSvgPath } from "./qr-code";
import { decode } from "../test/qr-decode";

describe("scannable trace QR", () => {
  it.each([
    "http://localhost:3000/trace/" + "a".repeat(32),
    "https://trace.agritrace.example/production/customer/region/trace/" +
      "a".repeat(100),
    "https://trace.example/trace/" +
      encodeURIComponent("Nguon goc nong san") +
      "a".repeat(100),
  ])("round-trips %s through an independent decoder", (value) => {
    const matrix = createQrMatrix(value);
    expect(decode(matrix)).toBe(value);
    expect(createQrSvgPath(matrix)).not.toBe("");
  });
});
