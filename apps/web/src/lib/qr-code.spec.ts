import jsQR from "jsqr";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it.each([
    ['http://localhost:3000', 'http://localhost:3000', true],
    ['https://agritrace.dev', 'http://localhost:3000', false],
    ['https://agritrace.dev', 'https://agritrace.dev', true],
    ['https://agritrace.dev/trace', 'https://agritrace.dev', true],
    ['http://localhost:3000/trace/', 'http://localhost:3000', true],
    ['https://agritrace.dev/', 'https://agritrace.dev', true],
    ['not-a-url', 'https://agritrace.dev', false],
    ['https://agritrace.dev', 'https://unrelated.example', false],
  ])('checks a decoded Web QR against mobile origin %s (QR %s)', async (configured, scanned, accepted) => {
    vi.stubEnv('EXPO_PUBLIC_TRACE_ORIGIN', configured);
    vi.resetModules();
    const { parseTraceToken } = await import('../../../mobile/src/lib/format');
    const token = 'demo_trace_token_0123456789';
    const decoded = decode(createQrMatrix(`${scanned}/trace/${token}`));
    expect(decoded).toBe(`${scanned}/trace/${token}`);
    expect(parseTraceToken(decoded!)).toBe(accepted ? token : null);
  });
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
