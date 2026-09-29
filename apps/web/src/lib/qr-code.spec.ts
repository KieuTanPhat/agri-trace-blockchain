import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { createQrMatrix, createQrSvgPath } from "./qr-code";

function decode(matrix: boolean[][]) {
  const scale = 6;
  const margin = 4;
  const size = (matrix.length + margin * 2) * scale;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (!dark) return;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset =
            (((y + margin) * scale + dy) * size + (x + margin) * scale + dx) *
            4;
          pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
        }
      }
    }),
  );
  return jsQR(pixels, size, size)?.data;
}

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
