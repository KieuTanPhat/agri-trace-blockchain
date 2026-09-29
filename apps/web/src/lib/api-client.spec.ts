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
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
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

describe("session and retry safety", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_MOCK_API", "false");
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status });
  it("keeps the same command key after refreshing authentication", async () => {
    const auth = {
      accessToken: "old",
      refreshToken: "refresh",
      user: { id: "u" },
    };
    localStorage.setItem("agritrace-auth", JSON.stringify(auth));
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ message: "expired" }, 401))
      .mockResolvedValueOnce(
        json({
          success: true,
          data: { ...auth, accessToken: "new", refreshToken: "rotated" },
        }),
      )
      .mockResolvedValueOnce(json({ success: true, data: { id: "created" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { request } = await import("./api-client");
    await expect(
      request("/production-cycles", {
        method: "POST",
        body: "{}",
        headers: { "idempotency-key": "stable" },
      }),
    ).resolves.toEqual({ id: "created" });
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key"),
    ).toBe("stable");
    expect(
      new Headers(fetchMock.mock.calls[2][1]?.headers).get("idempotency-key"),
    ).toBe("stable");
    expect(
      new Headers(fetchMock.mock.calls[2][1]?.headers).get("authorization"),
    ).toBe("Bearer new");
  });
  it("preserves the session when the refresh server is temporarily unavailable", async () => {
    localStorage.setItem(
      "agritrace-auth",
      JSON.stringify({ accessToken: "old", refreshToken: "refresh" }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({}, 401))
        .mockResolvedValueOnce(json({}, 503)),
    );
    const { getProfile } = await import("./api-client");
    await expect(getProfile()).rejects.toMatchObject({ status: 503 });
    expect(localStorage.getItem("agritrace-auth")).not.toBeNull();
  });
  it("does not resurrect a session logged out during refresh", async () => {
    localStorage.setItem(
      "agritrace-auth",
      JSON.stringify({ accessToken: "old", refreshToken: "refresh" }),
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(json({}, 401))
        .mockImplementationOnce(async () => {
          localStorage.clear();
          return json({
            success: true,
            data: { accessToken: "new", refreshToken: "rotated" },
          });
        }),
    );
    const { getProfile } = await import("./api-client");
    await expect(getProfile()).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem("agritrace-auth")).toBeNull();
  });
  it("reports a readable network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );
    const { login } = await import("./api-client");
    await expect(login("a@b.com", "password")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
    });
  });
  it.each([200, 401])(
    "discards a late %i response after switching accounts without changing the new session",
    async (status) => {
      const oldAuth = {
        accessToken: "old",
        refreshToken: "old-refresh",
        user: { id: "old-user" },
      };
      const newAuth = {
        accessToken: "new",
        refreshToken: "new-refresh",
        user: { id: "new-user" },
      };
      localStorage.setItem("agritrace-auth", JSON.stringify(oldAuth));
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
        localStorage.setItem("agritrace-auth", JSON.stringify(newAuth));
        return json(
          { success: true, data: { secret: "old-user-data" } },
          status,
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      const { request } = await import("./api-client");
      await expect(request("/lots")).rejects.toMatchObject({
        code: "SESSION_CHANGED",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(JSON.parse(localStorage.getItem("agritrace-auth")!)).toEqual(
        newAuth,
      );
    },
  );
  it("uses the caller's stable key for a sensor retry", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        json({
          success: true,
          data: { status: "accepted", readingId: "reading" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSensorReading } = await import("./api-client");
    const payload = {
      deviceId: "device",
      cycleId: "cycle",
      sensorType: "TEMPERATURE",
      value: 25,
      unit: "C",
      recordedAt: "2026-09-29T00:00:00.000Z",
    };
    await sendSensorReading(payload, "sensor-key");
    await sendSensorReading(payload, "sensor-key");
    expect(
      fetchMock.mock.calls.map((call) =>
        new Headers(call[1]?.headers).get("idempotency-key"),
      ),
    ).toEqual(["sensor-key", "sensor-key"]);
  });
});

it("reads the API's nested error envelope", async () => {
  vi.resetModules();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: false,
          error: { code: "UNAUTHORIZED", message: "Sai email hoặc mật khẩu" },
        }),
        { status: 401 },
      ),
    ),
  );
  const { login } = await import("./api-client");
  await expect(login("user@example.com", "wrong")).rejects.toMatchObject({
    status: 401,
    code: "UNAUTHORIZED",
    message: "Sai email hoặc mật khẩu",
  });
  vi.unstubAllGlobals();
});
