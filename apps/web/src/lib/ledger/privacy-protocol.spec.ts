import { describe, expect, it } from "vitest";
import { commandRequest } from "../command-request";

describe("private command persistence boundary", () => {
  it.each([
    [
      "/privacy-requests",
      { requestType: "ACCESS", message: "Private request content" },
    ],
    [
      "/platform-privacy/breaches",
      {
        detectedAt: "2026-10-22T00:00:00.000Z",
        message: "Private incident content",
      },
    ],
  ])("excludes %s from saved-body recovery", (path, body) => {
    expect(commandRequest(path, "POST", JSON.stringify(body))).toBeNull();
  });
});
