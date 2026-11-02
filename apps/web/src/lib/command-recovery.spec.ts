import { webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  COMMAND_STORAGE_PREFIX,
  recoverableCommand,
  retrySavedCommand,
  inspectSavedCommand,
  pendingSavedCommands,
  type SavedCommand,
} from "./command-recovery";
import { installBrowserLocks } from "../test/browser-locks";

const owner = JSON.stringify(["user-one", "organization-one"]);
const context = () => ({ owner, assertCurrent: vi.fn() });
const command = (
  key = "original-key",
  name = "Private chain name",
): SavedCommand => ({
  path: "/supply-chains",
  method: "POST",
  key,
  body: JSON.stringify({ name }),
});

describe("Signed handover command reconciliation", () => {
  const intentId = "00000000-0000-4000-8000-000000000021";
  const signed = (
    key = "original-signing-key",
    signature = "A".repeat(86),
  ): SavedCommand => ({
    path: `/signing-intents/${intentId}/submit`,
    method: "POST",
    key,
    body: JSON.stringify({ signature }),
  });
  it("stores the original signature/body/key before submission and recovers through reload without signing again", async () => {
    const wire = transport();
    wire.send.mockImplementationOnce(async (saved) => {
      const ledger = JSON.parse(stored());
      expect(Object.values(ledger.entries)).toContainEqual(
        expect.objectContaining({
          body: saved.body,
          key: saved.key,
          status: "PENDING",
        }),
      );
      throw { status: 0, message: "Lost signed response" };
    });
    await expect(
      recoverableCommand(context(), signed(), wire),
    ).rejects.toMatchObject({ recoveryId: expect.any(String) });
    const pending = await pendingSavedCommands(context());
    expect(pending).toEqual([
      { id: expect.any(String), operation: "SUBMIT_SIGNED_INTENT" },
    ]);
    expect(JSON.stringify(pending)).not.toContain("A".repeat(86));
    await retrySavedCommand(context(), pending[0].id, wire);
    expect(wire.send.mock.calls[1][0]).toEqual(signed());
    expect(wire.inspect).toHaveBeenCalledWith(
      signed(),
      expect.objectContaining({
        operation: "SUBMIT_SIGNED_INTENT",
        payload: { intentId, signature: "A".repeat(86) },
      }),
    );
    expect(stored()).not.toContain("A".repeat(86));
    expect(stored()).not.toContain("committed-chain");
  });
  it("never replaces an uncertain signed intent with another signature or request identity", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0 });
    await recoverableCommand(context(), signed(), wire).catch(() => {});
    wire.inspect.mockResolvedValue({ status: "PROCESSING" });
    const before = stored();
    await expect(
      recoverableCommand(context(), signed("new-key", "B".repeat(86)), wire),
    ).rejects.toMatchObject({ code: "REQUEST_UNRESOLVED" });
    expect(stored()).toBe(before);
    expect(wire.send).toHaveBeenCalledTimes(1);
  });
  it("serializes signed commands between two tabs and reads the current server journal for the second", async () => {
    const wire = transport();
    let finish!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      finish = resolve;
    });
    wire.send.mockImplementationOnce(async () => {
      entered();
      await wait;
      return { id: "handover" };
    });
    wire.inspect.mockResolvedValue(committed({ id: "handover" }));
    const first = recoverableCommand(context(), signed(), wire);
    await ready;
    const second = recoverableCommand(
      context(),
      signed("second-tab-key"),
      wire,
    );
    finish();
    expect(await Promise.all([first, second])).toEqual([
      { id: "handover" },
      { id: "handover" },
    ]);
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(wire.inspect.mock.calls[0][0]).toEqual(signed());
  });
  it("requires current authority before replaying a terminal signed result after a grant revoke", async () => {
    const wire = transport();
    await recoverableCommand(context(), signed(), wire);
    wire.inspect.mockRejectedValue({
      status: 403,
      message: "Current grant revoked",
    });
    await expect(
      recoverableCommand(context(), signed("reload-key"), wire),
    ).rejects.toMatchObject({ status: 403 });
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(stored()).not.toContain("A".repeat(86));
  });
});
const committed = (
  result: Record<string, unknown> = { id: "committed-chain" },
) => ({ status: "COMMITTED" as const, responseStatus: 201, result });
const transport = () => ({
  send: vi.fn().mockResolvedValue({ id: "committed-chain" }),
  inspect: vi.fn().mockResolvedValue({ status: "NOT_FOUND" }),
});
const stored = () =>
  window.localStorage.getItem(COMMAND_STORAGE_PREFIX + owner)!;
let restoreLocks: () => void;

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  restoreLocks = installBrowserLocks();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreLocks();
});

describe("Command reconciliation across remount and tabs", () => {
  it.each(["NOT_FOUND", "PROCESSING", "RECONCILIATION_REQUIRED"])(
    "inspection alone keeps %s pending without resending or changing the original request",
    async (status) => {
      const wire = transport();
      wire.send.mockRejectedValueOnce({ status: 409 });
      await recoverableCommand(context(), command(), wire).catch(() => {});
      const before = stored();
      const [pending] = await pendingSavedCommands(context());
      wire.inspect.mockResolvedValue({ status });
      await expect(inspectSavedCommand(context(), pending.id, wire))
        .rejects.toMatchObject({ code: "REQUEST_UNRESOLVED" });
      expect(wire.send).toHaveBeenCalledTimes(1);
      expect(wire.inspect.mock.calls[0][0]).toEqual(command());
      expect(stored()).toBe(before);
    },
  );

  it("inspection rechecks current authority and cannot read another account's pending request", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 409 });
    await recoverableCommand(context(), command(), wire).catch(() => {});
    const [pending] = await pendingSavedCommands(context());
    const before = stored();
    await expect(inspectSavedCommand(
      { owner: "other-principal", assertCurrent() {} }, pending.id, wire,
    )).rejects.toMatchObject({ code: "RECOVERY_REFRESH" });
    const changed = context();
    changed.assertCurrent.mockImplementation(() => {
      throw { status: 401, code: "SESSION_CHANGED" };
    });
    await expect(inspectSavedCommand(changed, pending.id, wire))
      .rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(wire.inspect).not.toHaveBeenCalled();
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(stored()).toBe(before);
  });

  it("lists only owner-bound pending metadata after remount and never sends a command while listing", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0, message: "Lost response" });
    await expect(
      recoverableCommand(context(), command(), wire),
    ).rejects.toBeDefined();
    const list = await pendingSavedCommands(context());
    expect(list).toEqual([
      { id: expect.any(String), operation: "HYB_CREATE_CHAIN" },
    ]);
    expect(JSON.stringify(list)).not.toContain("Private chain name");
    expect(JSON.stringify(list)).not.toContain("original-key");
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(wire.inspect).not.toHaveBeenCalled();
    expect(
      await pendingSavedCommands({
        owner: "another-owner",
        assertCurrent: vi.fn(),
      }),
    ).toEqual([]);
    wire.inspect.mockResolvedValueOnce(committed());
    await retrySavedCommand(context(), list[0].id, wire);
    expect(await pendingSavedCommands(context())).toEqual([]);
    expect(stored()).not.toContain("Private chain name");
  });
  it("persists before writing, retains identity after a lost response and discards payload/result cache only after a known commit", async () => {
    const ctx = context(),
      wire = transport();
    wire.send.mockImplementationOnce(async (saved) => {
      expect(stored()).toContain(saved.key);
      expect(stored()).toContain("Private chain name");
      throw { status: 0, message: "Lost response" };
    });
    await expect(
      recoverableCommand(ctx, command(), wire),
    ).rejects.toMatchObject({ recoveryId: expect.any(String) });
    // A new component has a different key; the original persisted identity wins.
    await expect(
      recoverableCommand(context(), command("remounted-key"), wire),
    ).resolves.toEqual({ id: "committed-chain" });
    expect(wire.send.mock.calls[0][0]).toEqual(wire.send.mock.calls[1][0]);
    expect(wire.inspect).toHaveBeenCalledWith(
      command(),
      expect.objectContaining({
        operation: "HYB_CREATE_CHAIN",
        payload: { name: "Private chain name" },
      }),
    );
    expect(stored()).not.toContain("Private chain name");
    expect(stored()).not.toContain("committed-chain");
  });

  it("never sends a replacement key or changed payload while the original outcome is uncertain, including expiry", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0 });
    const error = (await recoverableCommand(context(), command(), wire).catch(
      (cause: unknown) => cause,
    )) as { recoveryId: string };
    const before = stored();
    wire.inspect.mockResolvedValue({ status: "RECONCILIATION_REQUIRED" });
    await expect(
      recoverableCommand(
        context(),
        command("replacement", "Changed name"),
        wire,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_UNRESOLVED" });
    await expect(
      retrySavedCommand(context(), error.recoveryId, wire),
    ).rejects.toMatchObject({ code: "REQUEST_UNRESOLVED" });
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(stored()).toBe(before);
  });

  it("recovers a positive journal without another write and requires acknowledgement before sending changed content", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0 });
    await recoverableCommand(context(), command(), wire).catch(() => {});
    wire.inspect.mockResolvedValue(committed());
    await expect(
      recoverableCommand(
        context(),
        command("new-key", "Different intent"),
        wire,
      ),
    ).rejects.toMatchObject({ code: "PREVIOUS_COMMITTED" });
    expect(wire.send).toHaveBeenCalledTimes(1);
    await expect(
      recoverableCommand(
        context(),
        command("new-key", "Different intent"),
        wire,
      ),
    ).resolves.toEqual({ id: "committed-chain" });
    expect(wire.send).toHaveBeenCalledTimes(2);
  });

  it("rechecks server authority before a terminal replay and cannot disclose a cached result after revocation", async () => {
    const wire = transport();
    await recoverableCommand(context(), command(), wire);
    wire.inspect.mockRejectedValue({ status: 403, message: "Grant revoked" });
    await expect(
      recoverableCommand(context(), command("new-key"), wire),
    ).rejects.toMatchObject({ status: 403 });
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(stored()).not.toContain("committed-chain");
  });

  it("serializes two actual tab attempts and reconciles the second through the original journal", async () => {
    const wire = transport();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    wire.send.mockImplementationOnce(async () => {
      entered();
      await pending;
      return { id: "committed-chain" };
    });
    wire.inspect.mockResolvedValue(committed());
    const first = recoverableCommand(context(), command(), wire);
    await ready;
    const second = recoverableCommand(
      context(),
      command("other-tab-key"),
      wire,
    );
    expect(wire.send).toHaveBeenCalledTimes(1);
    release();
    expect(await Promise.all([first, second])).toEqual([
      { id: "committed-chain" },
      { id: "committed-chain" },
    ]);
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(wire.inspect.mock.calls[0][0].key).toBe("original-key");
  });

  it("keeps separate principals and rejects an account/scope change before reading or sending the saved intent", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0 });
    const error = (await recoverableCommand(context(), command(), wire).catch(
      (cause: unknown) => cause,
    )) as { recoveryId: string };
    const before = stored();
    await expect(
      retrySavedCommand(
        { owner: "another-principal", assertCurrent() {} },
        error.recoveryId,
        wire,
      ),
    ).rejects.toMatchObject({ code: "RECOVERY_REFRESH" });
    const changed = context();
    changed.assertCurrent.mockImplementation(() => {
      throw { status: 401, code: "SESSION_CHANGED" };
    });
    await expect(
      retrySavedCommand(changed, error.recoveryId, wire),
    ).rejects.toMatchObject({ code: "SESSION_CHANGED" });
    expect(wire.inspect).not.toHaveBeenCalled();
    expect(wire.send).toHaveBeenCalledTimes(1);
    expect(stored()).toBe(before);
  });

  it("lets an explicit recovery retry use the original body even after a remount changed the visible form", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 0 });
    const error = (await recoverableCommand(context(), command(), wire).catch(
      (cause: unknown) => cause,
    )) as { recoveryId: string };
    await expect(
      retrySavedCommand(context(), error.recoveryId, wire),
    ).resolves.toEqual({ id: "committed-chain" });
    expect(wire.send.mock.calls[1][0]).toEqual(command());
  });

  it("permits a fresh identity only after a known rejection and explicit restart", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 409 });
    await recoverableCommand(context(), command(), wire).catch(() => {});
    wire.inspect.mockResolvedValue({
      status: "REJECTED",
      responseStatus: 409,
      result: { message: "Original request rejected" },
    });
    await expect(
      recoverableCommand(context(), command(), wire),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED", canRestart: true });
    await expect(
      recoverableCommand(context(), command(), wire),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      recoverableCommand(context(), command("explicit-new-key"), wire),
    ).resolves.toEqual({ id: "committed-chain" });
    expect(wire.send).toHaveBeenCalledTimes(2);
    expect(stored()).not.toContain("Private chain name");
  });

  it("reconciles a validation rejection with no record before allowing corrected input", async () => {
    const wire = transport();
    wire.send.mockRejectedValueOnce({ status: 400 });
    await recoverableCommand(context(), command(), wire).catch(() => {});
    await expect(
      recoverableCommand(
        context(),
        command("corrected-key", "Corrected name"),
        wire,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_REJECTED" });
    await expect(
      recoverableCommand(
        context(),
        command("corrected-key", "Corrected name"),
        wire,
      ),
    ).resolves.toEqual({ id: "committed-chain" });
  });

  it.each(["corrupt", "unwritable", "missing-locks"] as const)(
    "fails before mutation when recovery storage is %s",
    async (failure) => {
      const wire = transport();
      if (failure === "corrupt")
        window.localStorage.setItem(COMMAND_STORAGE_PREFIX + owner, "{broken");
      if (failure === "unwritable")
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new Error("Storage disabled");
        });
      if (failure === "missing-locks")
        Object.defineProperty(window.navigator, "locks", {
          configurable: true,
          value: undefined,
        });
      await expect(
        recoverableCommand(context(), command(), wire),
      ).rejects.toMatchObject({ status: 409 });
      expect(wire.send).not.toHaveBeenCalled();
      expect(wire.inspect).not.toHaveBeenCalled();
    },
  );
});
