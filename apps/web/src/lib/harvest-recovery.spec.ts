import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getHarvestRequestStatus,
  readSession,
  recordHarvest,
} from "./api-client";
import { getAuthorizationScope } from "./auth-scope";
import {
  beginNewHarvest,
  HARVEST_STORAGE_PREFIX,
  recoverHarvest,
  sendHarvest,
} from "./harvest-recovery";
import type { LoginResponse } from "./types";

vi.mock("./api-client", () => ({
  getHarvestRequestStatus: vi.fn(),
  readSession: vi.fn(),
  recordHarvest: vi.fn(),
}));
const cycleId = "59c1b564-2736-4ea7-bdb5-701e20423f23";
const originalUser = {
  id: "87247bd2-c19b-4f9c-ab44-fd2ea5f96fa",
  role: { code: "FARM_STAFF", name: "Farm" },
  organizationId: "173f44c2-06ef-4221-8c75-f68e292415b0",
  accountStatus: "ACTIVE",
} as LoginResponse["user"];
const scope = getAuthorizationScope(originalUser);
const input = {
  quantity: 10,
  unit: "kg",
  lotCode: undefined,
  expiryDate: undefined,
};
const result = {
  lot: { id: "ad2fbfe8-5837-40db-b8f7-d22cfae5fba2", lotCode: "AUTO-1" },
  traceQr: { traceToken: "public-qr" },
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  let queue = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_name: string, callback: () => Promise<unknown>) => {
        const task = queue.then(callback);
        queue = task.then(
          () => undefined,
          () => undefined,
        );
        return task;
      }),
    },
  });
  vi.mocked(readSession).mockReturnValue({
    user: originalUser,
    accessToken: "private-session-token",
    tokenType: "Bearer",
  });
  vi.mocked(getHarvestRequestStatus).mockResolvedValue({ status: "NOT_FOUND" });
  vi.mocked(recordHarvest).mockImplementation(async () => {
    vi.mocked(getHarvestRequestStatus).mockResolvedValue({
      status: "COMMITTED",
      result,
    });
    return result as never;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("durable harvest recovery", () => {
  it("does not reserve an intent for invalid quantity or blank unit", async () => {
    await expect(
      sendHarvest(scope, "", cycleId, { ...input, quantity: 0.0001 }),
    ).rejects.toThrow("chưa hợp lệ");
    await expect(
      sendHarvest(scope, "", cycleId, { ...input, unit: " " }),
    ).rejects.toThrow("chưa hợp lệ");
    expect((await recoverHarvest(scope)).state.intent).toBeNull();
    expect(recordHarvest).not.toHaveBeenCalled();
  });
  it("recovers a commit after a lost response without another POST, and stores only metadata", async () => {
    vi.mocked(recordHarvest).mockImplementationOnce(async () => {
      vi.mocked(getHarvestRequestStatus).mockResolvedValue({
        status: "COMMITTED",
        result,
      });
      throw new Error("response lost after commit");
    });
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow(
      "response lost",
    );
    const recovered = await recoverHarvest(scope);
    expect(recovered.status).toEqual({ status: "COMMITTED", result });
    expect(recordHarvest).toHaveBeenCalledTimes(1);
    const metadata = localStorage.getItem(HARVEST_STORAGE_PREFIX + scope)!;
    expect(JSON.parse(metadata).intent.key).toBe(
      vi.mocked(recordHarvest).mock.calls[0][2],
    );
    for (const privateField of [
      "quantity",
      "unit",
      "lotCode",
      "private-session-token",
      "public-qr",
    ])
      expect(metadata).not.toContain(privateField);
  });

  it("retries NOT_FOUND with the original key, time and payload after reload", async () => {
    vi.mocked(recordHarvest).mockRejectedValueOnce(
      new Error("network failed before delivery"),
    );
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow();
    const restored = await recoverHarvest(scope);
    await sendHarvest(scope, restored.state.revision, cycleId, input);
    expect(vi.mocked(recordHarvest).mock.calls[1]).toEqual(
      vi.mocked(recordHarvest).mock.calls[0],
    );
  });

  it("rejects changed fields while a request is uncertain", async () => {
    vi.mocked(recordHarvest).mockRejectedValueOnce(new Error("network"));
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow();
    const restored = await recoverHarvest(scope);
    await expect(
      sendHarvest(scope, restored.state.revision, cycleId, {
        ...input,
        quantity: 11,
      }),
    ).rejects.toThrow("đúng nội dung");
    expect(recordHarvest).toHaveBeenCalledTimes(1);
    await expect(
      beginNewHarvest(scope, restored.state.revision),
    ).rejects.toThrow("Chưa xác định");
  });

  it("does not re-execute PROCESSING or cached-success records without a journal", async () => {
    vi.mocked(recordHarvest).mockRejectedValueOnce(new Error("uncertain"));
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow();
    vi.mocked(getHarvestRequestStatus).mockResolvedValue({
      status: "NEEDS_RECONCILIATION",
    });
    const restored = await recoverHarvest(scope);
    expect(
      (await sendHarvest(scope, restored.state.revision, cycleId, input)).status
        ?.status,
    ).toBe("NEEDS_RECONCILIATION");
    await expect(
      beginNewHarvest(scope, restored.state.revision),
    ).rejects.toThrow();
    expect(recordHarvest).toHaveBeenCalledTimes(1);
  });

  it("serializes two tabs that opened the same empty form into one harvest", async () => {
    const tabA = await recoverHarvest(scope),
      tabB = await recoverHarvest(scope);
    const [first, second] = await Promise.all([
      sendHarvest(scope, tabA.state.revision, cycleId, input),
      sendHarvest(scope, tabB.state.revision, cycleId, input),
    ]);
    expect(recordHarvest).toHaveBeenCalledTimes(1);
    expect(first.state.intent?.key).toBe(second.state.intent?.key);
    expect(second.status).toEqual({ status: "COMMITTED", result });
  });

  it("fences a stale form after an explicit new-harvest action", async () => {
    const staleTab = await recoverHarvest(scope);
    const first = await sendHarvest(scope, "", cycleId, input);
    const fresh = await beginNewHarvest(scope, first.state.revision);
    await expect(
      sendHarvest(scope, staleTab.state.revision, cycleId, input),
    ).rejects.toThrow("tab khác");
    await sendHarvest(scope, fresh.revision, cycleId, input);
    expect(recordHarvest).toHaveBeenCalledTimes(2);
    expect(vi.mocked(recordHarvest).mock.calls[1][2]).not.toBe(
      vi.mocked(recordHarvest).mock.calls[0][2],
    );
  });

  it("allows an explicit replacement only after a terminal business rejection", async () => {
    vi.mocked(recordHarvest).mockRejectedValueOnce(
      new Error("business validation"),
    );
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow();
    const restored = await recoverHarvest(scope);
    vi.mocked(getHarvestRequestStatus).mockResolvedValue({
      status: "REJECTED",
    });
    expect(
      (await beginNewHarvest(scope, restored.state.revision)).intent,
    ).toBeNull();
  });

  it.each(["setItem", "getItem"] as const)(
    "fails before POST when storage.%s is unavailable",
    async (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error("storage disabled");
      });
      await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow(
        "Không lưu hoặc đọc",
      );
      expect(recordHarvest).not.toHaveBeenCalled();
    },
  );

  it("fails closed on corrupt metadata or unsupported cross-tab locking", async () => {
    localStorage.setItem(HARVEST_STORAGE_PREFIX + scope, '{"version":1}');
    await expect(recoverHarvest(scope)).rejects.toThrow("Không lưu hoặc đọc");
    localStorage.clear();
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    await expect(sendHarvest(scope, "", cycleId, input)).rejects.toThrow(
      "Trình duyệt",
    );
    expect(recordHarvest).not.toHaveBeenCalled();
  });

  it.each([
    { id: "261c1d9b-1631-4a25-bd7c-33a4584efb40" },
    { organizationId: "ff55e81e-38db-4633-a866-e0f8040325d1" },
    { role: { code: "SYSTEM_ADMIN", name: "Admin" } },
  ])("isolates a different actor scope: %j", async (change) => {
    await sendHarvest(scope, "", cycleId, input);
    vi.mocked(getHarvestRequestStatus).mockClear();
    const changed = { ...originalUser, ...change } as LoginResponse["user"];
    vi.mocked(readSession).mockReturnValue({ user: changed } as LoginResponse);
    await expect(recoverHarvest(scope)).rejects.toThrow("quyền đã thay đổi");
    if (changed.role.code === "FARM_STAFF")
      expect(
        (await recoverHarvest(getAuthorizationScope(changed))).state.intent,
      ).toBeNull();
    expect(getHarvestRequestStatus).not.toHaveBeenCalled();
  });

  it("keeps recovery available after the same account signs in again", async () => {
    await sendHarvest(scope, "", cycleId, input);
    vi.mocked(readSession).mockReturnValue({
      user: originalUser,
      accessToken: "rotated-token",
    } as LoginResponse);
    expect((await recoverHarvest(scope)).status?.status).toBe("COMMITTED");
  });
});
