import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "./api-client";
import { useWorkspaceCommand } from "./workspace";

vi.mock("./api-client", () => ({ request: vi.fn() }));
vi.mock("./auth-store", () => ({
  useAuth: () => ({ user: { id: "u1", organizationId: "org", role: { code: "FARM_STAFF" } } }),
}));
vi.mock("./confirm", () => ({
  importantAction: () => null,
  useConfirm: () => async () => true,
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(request).mockReset();
});
afterEach(() => vi.useRealTimers());

it("resends an uncertain command with the same body and key without a retry action", async () => {
  vi.mocked(request)
    .mockRejectedValueOnce({ status: 0, message: "Mất kết nối" })
    .mockRejectedValueOnce({ status: 503, message: "Tạm thời lỗi" })
    .mockResolvedValueOnce({ id: "created" });
  const { result } = renderHook(() => useWorkspaceCommand());
  let outcome: unknown;
  await act(async () => {
    const run = result.current.run("/enterprise-workspace/members", { a: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    outcome = await run;
  });
  expect(outcome).toEqual({ id: "created" });
  const calls = vi.mocked(request).mock.calls;
  expect(calls).toHaveLength(3);
  expect(calls[1][1]).toEqual(calls[0][1]);
  expect(calls[2][1]).toEqual(calls[0][1]);
  expect(result.current.frozen).toBe(false);
  expect(result.current.error).toBe("");
});

it("unlocks the form at once on a definitive validation error", async () => {
  vi.mocked(request).mockRejectedValueOnce({
    status: 400,
    message: "Số điện thoại không hợp lệ",
  });
  const { result } = renderHook(() => useWorkspaceCommand());
  await act(async () => {
    await result.current.run("/enterprise-workspace/members", { a: 1 });
  });
  expect(vi.mocked(request)).toHaveBeenCalledTimes(1);
  expect(result.current.frozen).toBe(false);
  expect(result.current.error).toBe("Số điện thoại không hợp lệ");
});
