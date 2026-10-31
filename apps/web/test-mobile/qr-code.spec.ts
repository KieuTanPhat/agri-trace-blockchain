import { afterEach, describe, expect, it, vi } from "vitest";
import { createQrMatrix } from "../src/lib/qr-code";
import { decode } from "../src/test/qr-decode";

describe("Web QR to mobile scanner contract", () => {
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
    const { parseTraceToken } = await import('../../mobile/src/lib/format');
    const token = 'demo_trace_token_0123456789';
    const decoded = decode(createQrMatrix(`${scanned}/trace/${token}`));
    expect(decoded).toBe(`${scanned}/trace/${token}`);
    expect(parseTraceToken(decoded!)).toBe(accepted ? token : null);
  });
});
