import { describe, expect, it } from "vitest";
import { getTracePath } from "./trace-input";

describe("public QR input", () => {
  it.each([
    ["  abc_-123  ", "/trace/abc_-123"],
    ["https://agritrace.dev/trace/abc_-123", "/trace/abc_-123"],
    ["https://www.agritrace.dev/trace/abc/?campaign=test#proof", "/trace/abc"],
    ["http://13.140.170.166/trace/abc", "/trace/abc"],
    ["https://elsewhere.example/trace/abc", "/trace/abc"],
    ["https://agritrace.dev/trace/%61bc", "/trace/abc"],
  ])("normalizes %s to the local trace route", (input, expected) => {
    expect(getTracePath(input)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "javascript:alert(1)",
    "ftp://example.com/trace/abc",
    "https://example.com/admin/trace/abc",
    "https://example.com/trace/abc/extra",
    "https://example.com/trace/",
    "https://example.com/trace/%2Fadmin",
    "https://user:password@example.com/trace/abc",
    "https://example.com/trace/%",
    "abc/def",
    "token with spaces",
    "https://example.com/trace/../admin",
    "a".repeat(256),
  ])("rejects malformed input %s", (input) => {
    expect(getTracePath(input)).toBeNull();
  });
});
