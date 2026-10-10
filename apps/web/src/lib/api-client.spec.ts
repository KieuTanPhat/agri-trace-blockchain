import type { PublicLotTrace } from "./types";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";

const user = {
  id: "user-1",
  email: "staff@example.com",
  fullName: "Staff",
  organizationId: null,
  role: { code: "SYSTEM_ADMIN" as const, name: "Admin" },
  accountStatus: "ACTIVE",
};
const auth = { accessToken: "old", tokenType: "Bearer" as const, user };
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_MOCK_API", "false");
  vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "http://api.test/api");
  vi.stubEnv("NEXT_PUBLIC_API_SAME_ORIGIN", "false");
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public API", () => {
  it("uses the current browser origin in production so aliases retain cookie sessions", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_SAME_ORIGIN", "true");
    vi.stubEnv("NEXT_PUBLIC_API_BASE_URL", "https://agritrace.dev/api");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: auth }));
    vi.stubGlobal("fetch", fetchMock);
    const { login } = await import("./api-client");
    await login("staff@example.com", "test-password");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/login");
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
  });

  it("keeps server rendering on the configured internal API in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_API_SAME_ORIGIN", "true");
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://api:8080/api");
    vi.stubGlobal("window", undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: { lotId: "lot-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");
    await getPublicTrace("trace-token");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api:8080/api/public/trace/trace-token",
    );
  });

  it("preserves a separate configured API for production Web without the UAT proxy flag", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: auth }));
    vi.stubGlobal("fetch", fetchMock);
    const { login } = await import("./api-client");
    await login("staff@example.com", "test-password");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/auth/login");
  });

  it("maps a missing public trace to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(json({}, 404)),
    );
    const { getPublicTrace } = await import("./api-client");
    await expect(getPublicTrace("missing")).resolves.toBeNull();
  });
  it("reads public traces without authentication", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: { lotId: "lot-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");
    await expect(getPublicTrace("trace token")).resolves.toEqual({
      lotId: "lot-1",
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api.test/api/public/trace/trace%20token",
    );
  });

  it("accepts the public projection with nullable dates and no internal shipment fields", async () => {
    const trace = {
      lotId: "lot-1",
      traceToken: "trace-token",
      lotCode: "LOT-1",
      productName: "Vegetables",
      harvestTime: "2026-10-09T00:00:00.000Z",
      initialQuantity: 10,
      availableQuantity: 10,
      unit: "kg",
      currentState: "HARVESTED",
      expiryDate: null,
      isExpired: false,
      quantityReconciled: true,
      stateReconciled: true,
      warnings: ["NO_DATA"],
      sensorEvidence: {
        status: "NO_DATA",
        readingCount: 0,
        digestHash: null,
        periodStart: "2026-10-08T00:00:00.000Z",
        periodEnd: "2026-10-09T00:00:00.000Z",
        finalizedAt: "2026-10-09T00:00:00.000Z",
        lateReadingCount: 0,
      },
      productionCycle: {
        cycleId: "cycle-1",
        cycleCode: "CYCLE-1",
        currentState: "GROWING",
        startDate: null,
      },
      farmOrg: { organizationId: "farm-1", name: "Farm", type: "FARM" },
      allowedCommands: [],
      proofStatus: "PENDING",
      timeline: [
        {
          eventId: "event-1",
          entityType: "HARVEST",
          eventType: "HARVEST_RECORDED",
          eventTime: "2026-10-09T00:00:00.000Z",
          summary: "Harvest recorded",
          proofStatus: "PENDING",
          actor: { role: "SYSTEM_ACTOR", organizationName: "AgriTrace" },
        },
      ],
      blockchainProof: {
        network: "Fabric",
        dataHash: "a".repeat(64),
        transactionStatus: "PENDING",
        txId: null,
        recordedAt: null,
      },
      shipment: {
        status: "CREATED",
        origin: "Farm",
        destination: "Retailer",
        pickupTime: null,
        arrivalTime: null,
        receivedTime: null,
      },
      certificates: [
        {
          type: "Quality",
          issuer: "Issuer",
          issueDate: "2026-10-09T00:00:00.000Z",
          expiryDate: null,
          documentHash: "b".repeat(64),
          status: "APPROVED",
        },
      ],
    } satisfies PublicLotTrace;
    localStorage.setItem(
      "agritrace-auth",
      JSON.stringify({ accessToken: "private-session" }),
    );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ success: true, data: trace })),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");

    const result = await getPublicTrace(trace.traceToken);

    expectTypeOf(result).toEqualTypeOf<PublicLotTrace | null>();
    expect(result).toEqual(trace);
    expect(
      new Headers(fetchMock.mock.calls[0][1]?.headers).has("authorization"),
    ).toBe(false);
  });

  it("uses the internal API for server-side public traces", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://api:8080/api");
    vi.stubGlobal("window", undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: { lotId: "lot-1" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");
    await getPublicTrace("token");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://api:8080/api/public/trace/token",
    );
  });
});

describe("cookie-backed session", () => {
  it("shares the same browser lock across tab modules before mutating cookies", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      window.navigator,
      "locks",
    );
    let queue: Promise<unknown> = Promise.resolve();
    const lock = vi.fn((_name: string, operation: () => Promise<unknown>) => {
      const result = queue.then(operation);
      queue = result.catch(() => undefined);
      return result;
    });
    Object.defineProperty(window.navigator, "locks", {
      configurable: true,
      value: { request: lock },
    });
    let finish!: (response: Response) => void;
    const other = { ...auth, user: { ...user, id: "user-b" } };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(json({ success: true, data: other }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const tabA = await import("./api-client");
      tabA.setSession(auth);
      vi.resetModules();
      const tabB = await import("./api-client");
      const signingOut = tabA.revokeSession();
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const signingIn = tabB.login("b@example.com", "password");
      await vi.waitFor(() => expect(lock).toHaveBeenCalledTimes(2));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      finish(json({ success: true, data: { revoked: true } }));
      await signingOut;
      await signingIn;
      expect(tabA.readSession()).toBeNull();
      expect(tabB.readSession()).toEqual(other);
      expect(lock.mock.calls.map(([name]) => name)).toEqual([
        "agritrace-auth",
        "agritrace-auth",
      ]);
    } finally {
      if (descriptor)
        Object.defineProperty(window.navigator, "locks", descriptor);
      else Reflect.deleteProperty(window.navigator, "locks");
    }
  });
  it("recovers a concurrent 409 refresh without discarding the session", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(
        json({ success: true, data: { ...auth, accessToken: "rotated" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { restoreSession, readSession, setSession } =
      await import("./api-client");
    setSession(auth);
    await expect(restoreSession()).resolves.toMatchObject({
      accessToken: "rotated",
    });
    expect(readSession()?.user.id).toBe(user.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the existing session when refresh remains busy", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(json({}, 409)),
    );
    const { restoreSession, readSession, setSession } =
      await import("./api-client");
    setSession(auth);
    await expect(restoreSession(false)).rejects.toMatchObject({
      status: 409,
      code: "REFRESH_BUSY",
    });
    expect(readSession()).toEqual(auth);
  });

  it("keeps startup restoration pending and retries a busy rotation", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json({ success: true, data: auth }));
    vi.stubGlobal("fetch", fetchMock);
    const { restoreSession, isSessionRestoring, readSession } =
      await import("./api-client");
    const restoring = restoreSession();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), {
      timeout: 3000,
    });
    expect(isSessionRestoring()).toBe(true);
    expect(readSession()).toBeNull();
    await expect(restoring).resolves.toEqual(auth);
    expect(isSessionRestoring()).toBe(false);
  });

  it("serializes switching accounts after an in-flight refresh and rejects the old command", async () => {
    let finish!: (response: Response) => void;
    const other = {
      ...auth,
      accessToken: "b",
      user: { ...user, id: "user-b" },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce(json({ success: true, data: other }));
    vi.stubGlobal("fetch", fetchMock);
    const { request, login, readSession, setSession } =
      await import("./api-client");
    setSession(auth);
    const old = request("/lots");
    const rejected = expect(old).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const switching = login("b@example.com", "password");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    finish(
      json({ success: true, data: { ...auth, accessToken: "a-rotated" } }),
    );
    await rejected;
    await switching;
    expect(readSession()).toEqual(other);
    expect(
      fetchMock.mock.calls.map(([url]) =>
        new URL(String(url)).pathname.replace(/^\/api/, ""),
      ),
    ).toEqual(["/lots", "/auth/refresh", "/auth/login"]);
  });

  it("ignores a late refresh 401 after another identity has been selected", async () => {
    let finish!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const { restoreSession, setSession, readSession } =
      await import("./api-client");
    setSession(auth);
    const restoring = restoreSession();
    const rejected = expect(restoring).rejects.toMatchObject({
      code: "SESSION_CHANGED",
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    const other = { ...auth, user: { ...user, id: "user-b" } };
    setSession(other);
    finish(json({}, 401));
    await rejected;
    expect(readSession()).toEqual(other);
  });

  it("invalidates a tab before an action when another tab changes the browser identity", async () => {
    const other = {
      ...auth,
      accessToken: "b",
      user: { ...user, id: "user-b" },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: other }));
    vi.stubGlobal("fetch", fetchMock);
    const client = await import("./api-client");
    const { AUTH_SYNC_KEY } = await import("./auth-coordination");
    client.setSession(auth);
    localStorage.setItem(
      AUTH_SYNC_KEY,
      JSON.stringify({ id: "other-tab-login", state: "signed-in" }),
    );
    await expect(
      client.request("/shipments", { method: "POST", body: "{}" }),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    await vi.waitFor(() => expect(client.readSession()).toEqual(other));
    expect(
      fetchMock.mock.calls.every(([url]) =>
        String(url).endsWith("/auth/refresh"),
      ),
    ).toBe(true);
  });

  it("synchronizes a second tab's login/logout and clears old IoT data", async () => {
    const other = { ...auth, user: { ...user, id: "user-b" } };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ success: true, data: other })),
    );
    const client = await import("./api-client");
    const { AUTH_SYNC_KEY } = await import("./auth-coordination");
    const { getAuthorizationScope } = await import("./auth-scope");
    const { IOT_READING_STORAGE_KEY } = await import("./iot-local-store");
    client.setSession(auth);
    const key = `${IOT_READING_STORAGE_KEY}:${getAuthorizationScope(user)}`;
    localStorage.setItem(key, "[]");
    const stop = client.startSessionSynchronization();
    try {
      localStorage.setItem(
        AUTH_SYNC_KEY,
        JSON.stringify({ id: "tab-b-login", state: "signed-in" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: AUTH_SYNC_KEY }));
      expect(client.readSession()).toBeNull();
      expect(localStorage.getItem(key)).toBeNull();
      await vi.waitFor(() => expect(client.readSession()).toEqual(other));
      localStorage.setItem(
        AUTH_SYNC_KEY,
        JSON.stringify({ id: "tab-b-logout", state: "signed-out" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key: AUTH_SYNC_KEY }));
      expect(client.readSession()).toBeNull();
    } finally {
      stop();
    }
  });

  it("clears the stored IoT scope after logout and role changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(json({ success: true, data: { revoked: true } })),
    );
    const { setSession, revokeSession, readSession } =
      await import("./api-client");
    const { getAuthorizationScope } = await import("./auth-scope");
    const { IOT_READING_STORAGE_KEY } = await import("./iot-local-store");
    setSession(auth);
    const key = `${IOT_READING_STORAGE_KEY}:${getAuthorizationScope(user)}`;
    localStorage.setItem(key, "[]");
    setSession(
      {
        ...auth,
        user: { ...user, role: { ...user.role, code: "FARM_STAFF" } },
      },
      false,
    );
    expect(localStorage.getItem(key)).toBeNull();
    setSession(auth);
    localStorage.setItem(key, "[]");
    await revokeSession();
    expect(readSession()).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("keeps access tokens in memory and sends credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ success: true, data: auth }))
      .mockResolvedValueOnce(json({ success: true, data: { id: "lot" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { login, request } = await import("./api-client");
    await login("staff@example.com", "password");
    await request("/lots");
    expect(localStorage.getItem("agritrace-auth")).toBeNull();
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[1][1]?.credentials).toBe("include");
    expect(
      new Headers(fetchMock.mock.calls[1][1]?.headers).get("authorization"),
    ).toBe("Bearer old");
  });

  it("restores a session using only the HttpOnly cookie", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ success: true, data: auth }));
    vi.stubGlobal("fetch", fetchMock);
    const { restoreSession, readSession } = await import("./api-client");
    await expect(restoreSession()).resolves.toEqual(auth);
    expect(readSession()).toEqual(auth);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/auth/refresh");
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it("retries a command with its original idempotency key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(
        json({ success: true, data: { ...auth, accessToken: "new" } }),
      )
      .mockResolvedValueOnce(json({ success: true, data: { id: "created" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { request, setSession } = await import("./api-client");
    setSession(auth);
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

  it("does not resurrect a session logged out during refresh", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockImplementationOnce(async () => {
        clearSession();
        return json({ success: true, data: { ...auth, accessToken: "new" } });
      });
    vi.stubGlobal("fetch", fetchMock);
    const { request, setSession, clearSession, readSession } =
      await import("./api-client");
    setSession(auth);
    await expect(request("/lots")).rejects.toMatchObject({ status: 401 });
    expect(readSession()).toBeNull();
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
  it("uses the caller's stable key for a sensor retry", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () =>
      json({
        success: true,
        data: { status: "accepted", readingId: "reading" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { sendSensorReading, setSession } = await import("./api-client");
    setSession(auth);
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
  it("keeps the in-memory session if logout cannot reach the server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const { readSession, revokeSession, setSession } =
      await import("./api-client");
    setSession(auth);
    await expect(revokeSession()).rejects.toThrow("offline");
    expect(readSession()).toEqual(auth);
  });

  it("discards a late response from the previous account", async () => {
    let finishOld!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockReturnValue(
        new Promise((resolve) => {
          finishOld = resolve;
        }),
      ),
    );
    const { request, readSession, setSession } = await import("./api-client");
    setSession(auth);
    const oldRequest = request("/lots");
    const other = {
      ...auth,
      accessToken: "other",
      user: { ...user, id: "user-2" },
    };
    setSession(other);
    finishOld(json({ success: true, data: [{ id: "old-lot" }] }));
    await expect(oldRequest).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(readSession()).toEqual(other);
  });
});
