import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(resolve(process.cwd(), "public/sw.js"), "utf8");
function worker() {
  const handlers = new Map<string, (event: unknown) => void>();
  const fetch = vi.fn().mockRejectedValue(new Error("offline"));
  const match = vi.fn().mockResolvedValue("public-offline-page");
  const addAll = vi.fn().mockResolvedValue(undefined);
  const open = vi.fn().mockResolvedValue({ match, addAll });
  const remove = vi.fn().mockResolvedValue(true);
  const globalMatch = vi.fn().mockResolvedValue("stale-account-data");
  runInNewContext(script, {
    URL,
    Promise,
    fetch,
    self: {
      location: { origin: "https://agritrace.test" },
      addEventListener: (type: string, handler: (event: unknown) => void) =>
        handlers.set(type, handler),
    },
    caches: { open, match: globalMatch, delete: remove, keys: async () => ["agri-traceability-old", "agri-traceability-ledger-v1", "unrelated"] },
    Response,
  });
  return { fetch, match, open, globalMatch, addAll, remove, handlers, onFetch: handlers.get("fetch")! };
}

describe("service worker request isolation", () => {
  it("installs only a static offline page and removes retired app caches", async () => {
    const {handlers,addAll,remove}=worker();
    const waitUntil=vi.fn();
    handlers.get("install")!({waitUntil});
    await waitUntil.mock.calls[0][0];
    expect(addAll).toHaveBeenCalledWith(["/offline.html"]);
    waitUntil.mockClear();
    handlers.get("activate")!({waitUntil});
    await waitUntil.mock.calls[0][0];
    expect(remove.mock.calls).toEqual([["agri-traceability-old"]]);
  });
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
  it.each(["/lots", "/dashboard", "/trace/public-token"])("only falls back to the static explanation for offline navigation to %s", async (path) => {
    const { onFetch, match, open, globalMatch } = worker();
    const respondWith = vi.fn();
    onFetch({
      request: {
        method: "GET",
        url: `https://agritrace.test${path}`,
        mode: "navigate",
      },
      respondWith,
    });
    await expect(respondWith.mock.calls[0][0]).resolves.toBe(
      "public-offline-page",
    );
    expect(match).toHaveBeenCalledWith("/offline.html");
    expect(open).toHaveBeenCalledWith("agri-traceability-ledger-v1");
    expect(globalMatch).not.toHaveBeenCalled();
  });
});
