import test from "node:test";
import assert from "node:assert/strict";
import { parseTraceToken } from "../src/scan/parse-token";
import { apiBaseUrl } from "../src/config";
import { TOKEN } from "./fixtures";

test("accepts raw tokens and the configured trace origin only", () => {
  const origin = "https://agritrace.example";
  assert.equal(parseTraceToken(`  ${TOKEN}  `, origin), TOKEN);
  assert.equal(parseTraceToken(`${origin}/trace/${TOKEN}`, origin), TOKEN);
  assert.equal(parseTraceToken(`${origin}/trace/${TOKEN}/`, origin), TOKEN);
  for (const input of [
    `https://evil.example/trace/${TOKEN}`,
    `http://agritrace.example/trace/${TOKEN}`,
    `https://agritrace.example.evil.example/trace/${TOKEN}`,
    `https://user@agritrace.example/trace/${TOKEN}`,
    `${origin}/trace/${TOKEN}?next=https://evil.example`,
    `${origin}/trace/${TOKEN}#other`,
    `${origin}/login`,
    `javascript:alert(1)`,
    `<script>alert(1)</script>`,
    `agritrace://trace/${TOKEN}`,
    `https://agritrace.example\\@evil.example/trace/${TOKEN}`,
    "short",
    "x".repeat(129),
    "a".repeat(2050),
    `${TOKEN}\u0000`,
  ])
    assert.equal(parseTraceToken(input, origin), null, input);
});

test("API configuration is explicit, credential-free and HTTPS in release", () => {
  assert.equal(
    apiBaseUrl("https://api.example/api", false),
    "https://api.example/api",
  );
  assert.equal(
    apiBaseUrl("http://10.0.2.2:8080/api", true),
    "http://10.0.2.2:8080/api",
  );
  for (const value of [
    undefined,
    "",
    "invalid",
    "http://example/api",
    "https://user:pass@example/api",
    "https://example/api?secret=x",
    "https://example/other",
  ])
    assert.throws(() => apiBaseUrl(value, false));
});
