import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const call = (z: string, x: string, y: string) => GET(new Request("http://localhost/map-tiles"), { params: Promise.resolve({ z, x, y }) });

afterEach(() => vi.unstubAllGlobals());

describe("map tile proxy", () => {
  it("refuses coordinates outside the tile grid without calling upstream", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    for (const [z, x, y] of [["20", "0", "0.png"], ["3", "8", "0.png"], ["3", "0", "8.png"], ["3", "0", "0.jpg"], ["a", "0", "0.png"], ["3", "../0", "0.png"]])
      expect((await call(z, x, y)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("serves the OpenStreetMap tile from the same origin with a cache header", async () => {
    const fetch = vi.fn(async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetch);
    const response = await call("7", "102", "60.png");
    expect(fetch).toHaveBeenCalledWith("https://tile.openstreetmap.org/7/102/60.png", expect.anything());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("public");
  });

  it("does not pass through a non-image upstream answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("blocked", { status: 403, headers: { "content-type": "text/html" } })));
    expect((await call("7", "102", "60.png")).status).toBe(502);
  });
});
