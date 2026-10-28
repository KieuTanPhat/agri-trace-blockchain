import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearSession, setSession } from "../api-client";
import { actorA } from "@/test/ledger-actors";
type Request = <T>(
  path: string,
  init?: RequestInit,
  authenticated?: boolean,
  canRefresh?: boolean,
) => Promise<T>;
const modules = import.meta.glob<{ ledgerRequest: Request }>("./request.ts", {
  eager: true,
});
beforeEach(() => {
  clearSession(false);
  setSession(actorA);
});
afterEach(() => {
  clearSession(false);
  vi.unstubAllGlobals();
});
it("delegates authentication and unwraps exactly the baseline envelope", async () => {
  const request = modules["./request.ts"]?.ledgerRequest;
  expect(request, "baseline Ledger transport delegation is missing").toBeTypeOf(
    "function",
  );
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({
      success: true,
      data: { data: { id: "nested-domain-data" } },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await request!("/fixture-domain")).toEqual({
    data: { id: "nested-domain-data" },
  });
  expect(
    new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("authorization"),
  ).toBe("Bearer test-actor-a-token");
});
it("respects unauthenticated and refresh-disabled calls", async () => {
  const request = modules["./request.ts"]?.ledgerRequest;
  expect(request).toBeTypeOf("function");
  const seen: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(input));
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      return Response.json(
        { success: false, error: { code: "UNAUTHORIZED", message: "Denied" } },
        { status: 401 },
      );
    }),
  );
  await expect(
    request!("/public-fixture", {}, false, false),
  ).rejects.toMatchObject({ status: 401 });
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatch(/\/public-fixture$/);
});
it("one_refresh_for_concurrent_401 retains the baseline refresh flight", async () => {
  const request = modules["./request.ts"]!.ledgerRequest;
  let refreshes = 0;
  const attempts = new Map<string, number>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/auth/refresh")) {
        refreshes++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return Response.json({
          success: true,
          data: { ...actorA, accessToken: "rotated-fixture-token" },
        });
      }
      if (path.endsWith("/chain-permissions"))
        return Response.json({
          success: true,
          data: {
            accessRevision: actorA.user.accessRevision,
            productionChains: [],
          },
        });
      const count = attempts.get(path) ?? 0;
      attempts.set(path, count + 1);
      return count
        ? Response.json({ success: true, data: { id: path } })
        : Response.json(
            {
              success: false,
              error: { code: "UNAUTHORIZED", message: "Expired" },
            },
            { status: 401 },
          );
    }),
  );
  const results = await Promise.all([
    request<{ id: string }>("/fixture-a"),
    request<{ id: string }>("/fixture-b"),
  ]);
  expect(refreshes).toBe(1);
  expect(results.map((value) => value.id)).toEqual([
    expect.stringMatching(/fixture-a$/),
    expect.stringMatching(/fixture-b$/),
  ]);
  expect([...attempts.values()]).toEqual([2, 2]);
});
