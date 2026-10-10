import type { PublicLotTrace } from "./types";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

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
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("public API", () => {
  it("reads public traces without authentication", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({ success: true, data: { lotId: "lot-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");
    await expect(getPublicTrace("trace token")).resolves.toEqual({ lotId: "lot-1" });
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
      productionCycle: {
        cycleId: "cycle-1",
        cycleCode: "CYCLE-1",
        currentState: "GROWING",
        startDate: null,
      },
      farmOrg: { organizationId: "farm-1", name: "Farm", type: "FARM" },
      allowedCommands: [],
      proofStatus: "PENDING",
      timeline: [{
        eventId: "event-1",
        entityType: "HARVEST",
        eventType: "HARVEST_RECORDED",
        eventTime: "2026-10-09T00:00:00.000Z",
        summary: "Harvest recorded",
        proofStatus: "PENDING",
        actor: { role: "SYSTEM_ACTOR", organizationName: "AgriTrace" },
      }],
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
      certificates: [{
        type: "Quality",
        issuer: "Issuer",
        issueDate: "2026-10-09T00:00:00.000Z",
        expiryDate: null,
        documentHash: "b".repeat(64),
        status: "APPROVED",
      }],
    } satisfies PublicLotTrace;
    localStorage.setItem("agritrace-auth", JSON.stringify({ accessToken: "private-session" }));
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ success: true, data: trace })),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");

    const result = await getPublicTrace(trace.traceToken);

    expectTypeOf(result).toEqualTypeOf<PublicLotTrace | null>();
    expect(result).toEqual(trace);
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).has("authorization")).toBe(false);
  });

  it("uses the internal API for server-side public traces", async () => {
    vi.stubEnv("API_INTERNAL_BASE_URL", "http://api:8080/api");
    vi.stubGlobal("window", undefined);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({ success: true, data: { lotId: "lot-1" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { getPublicTrace } = await import("./api-client");
    await getPublicTrace("token");
    expect(fetchMock.mock.calls[0][0]).toBe("http://api:8080/api/public/trace/token");
  });
});

describe("cookie-backed session", () => {
  it("keeps access tokens in memory and sends credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ success: true, data: auth }))
      .mockResolvedValueOnce(json({ success: true, data: { id: "lot" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { login, request } = await import("./api-client");
    await login("staff@example.com", "password");
    await request("/lots");
    expect(localStorage.getItem("agritrace-auth")).toBeNull();
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[1][1]?.credentials).toBe("include");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("authorization"))
      .toBe("Bearer old");
  });

  it("restores a session using only the HttpOnly cookie", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      json({ success: true, data: auth }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { restoreSession, readSession } = await import("./api-client");
    await expect(restoreSession()).resolves.toEqual(auth);
    expect(readSession()).toEqual(auth);
    expect(fetchMock.mock.calls[0][0]).toBe("http://api.test/api/auth/refresh");
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe("include");
    expect(fetchMock.mock.calls[0][1]?.body).toBeUndefined();
  });

  it("retries a command with its original idempotency key", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockResolvedValueOnce(json({ success: true, data: { ...auth, accessToken: "new" } }))
      .mockResolvedValueOnce(json({ success: true, data: { id: "created" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { request, setSession } = await import("./api-client");
    setSession(auth);
    await expect(request("/production-cycles", {
      method: "POST",
      body: "{}",
      headers: { "idempotency-key": "stable" },
    })).resolves.toEqual({ id: "created" });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("idempotency-key"))
      .toBe("stable");
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("idempotency-key"))
      .toBe("stable");
    expect(new Headers(fetchMock.mock.calls[2][1]?.headers).get("authorization"))
      .toBe("Bearer new");
  });

  it("does not resurrect a session logged out during refresh", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 401))
      .mockImplementationOnce(async () => {
        clearSession();
        return json({ success: true, data: { ...auth, accessToken: "new" } });
      });
    vi.stubGlobal("fetch", fetchMock);
    const { request, setSession, clearSession, readSession } = await import("./api-client");
    setSession(auth);
    await expect(request("/lots")).rejects.toMatchObject({ status: 401 });
    expect(readSession()).toBeNull();
  });

  it("reports a readable network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
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
    const { readSession, revokeSession, setSession } = await import("./api-client");
    setSession(auth);
    await expect(revokeSession()).rejects.toThrow("offline");
    expect(readSession()).toEqual(auth);
  });

  it("discards a late response from the previous account", async () => {
    let finishOld!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValue(
      new Promise((resolve) => { finishOld = resolve; }),
    ));
    const { request, readSession, setSession } = await import("./api-client");
    setSession(auth);
    const oldRequest = request("/lots");
    const other = { ...auth, accessToken: "other", user: { ...user, id: "user-2" } };
    setSession(other);
    finishOld(json({ success: true, data: [{ id: "old-lot" }] }));
    await expect(oldRequest).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(readSession()).toEqual(other);
  });
});
