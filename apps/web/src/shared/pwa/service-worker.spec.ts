import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  const match = vi.fn().mockResolvedValue("public-offline-page");
  runInNewContext(script, {
    URL,
    Promise,
    fetch,
    self: {
      location: { origin: "https://agritrace.test" },
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
    },
    caches: { match },
  });
  return { fetch, match, onFetch: handlers.get("fetch")! };
}

describe("service worker request isolation", () => {
  it.each([
    ["https://api.test/api/lots", "cors"],
    ["https://agritrace.test/api/lots", "navigate"],
    ["https://agritrace.test/api/lots", "cors"],
    ["https://agritrace.test/_next/static/script.js", "no-cors"],
  ])("never substitutes HTML for %s (%s)", (url, mode) => {
    const { onFetch, fetch } = worker();
    const respondWith = vi.fn();
    onFetch({ request: { method: "GET", url, mode }, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("only falls back to the public scan page for offline navigation", async () => {
    const { onFetch, match } = worker();
    const respondWith = vi.fn();
    onFetch({
      request: {
        method: "GET",
        url: "https://agritrace.test/lots",
        mode: "navigate",
      },
      respondWith,
    });
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(
      "public-offline-page",
    );
    expect(match).toHaveBeenCalledWith("/scan");
  });
});
