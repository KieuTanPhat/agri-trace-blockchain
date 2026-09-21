import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("API client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_MOCK_API", "false");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/api");
    vi.resetModules();
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the real public trace endpoint and unwraps the API envelope", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ success: true, data: { lotId: "lot-1" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");

    const result = await getPublicTrace("trace token");

    expect(result?.lotId).toBe("lot-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api.test/api/public/trace/trace%20token");
    expect(new Headers(init?.headers).has("idempotency-key")).toBe(false);
  });

  it("maps a 404 public trace response to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ message: "Không tìm thấy" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const { getPublicTrace } = await import("./api-client");

    await expect(getPublicTrace("missing")).resolves.toBeNull();
  });
});
