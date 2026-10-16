import { parseTraceToken } from "./trace-input";

describe("parseTraceToken", () => {
  it("accepts a typed token and trims whitespace", () => {
    expect(parseTraceToken("  abc_DEF-123 ")).toBe("abc_DEF-123");
  });

  it("reads the token from a local path or a QR URL", () => {
    expect(parseTraceToken("/trace/abc123/")).toBe("abc123");
    expect(parseTraceToken("https://agritrace.dev/trace/abc123")).toBe("abc123");
    expect(parseTraceToken("http://localhost:3000/trace/abc%5F123")).toBe("abc_123");
  });

  it("rejects anything that is not an AgriTrace trace link", () => {
    expect(parseTraceToken("")).toBeNull();
    expect(parseTraceToken("javascript:alert(1)")).toBeNull();
    expect(parseTraceToken("https://user:pass@agritrace.dev/trace/abc")).toBeNull();
    expect(parseTraceToken("https://agritrace.dev/lots/abc")).toBeNull();
    expect(parseTraceToken("https://agritrace.dev/trace/a%2Fb")).toBeNull();
    expect(parseTraceToken("ftp://agritrace.dev/trace/abc")).toBeNull();
  });
});
