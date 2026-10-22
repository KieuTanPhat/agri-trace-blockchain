import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "./api-client";
import { useWorkspaceCommand } from "./workspace";

vi.mock("./api-client", () => ({ request: vi.fn() }));
const context=vi.hoisted(()=>({revision:'first'}));
vi.mock("./auth-store", () => ({
  useAuth: () => ({ user: { id: "u1", organizationId: "org", role: { code: "FARM_STAFF" },accessRevision:context.revision } }),
}));
vi.mock("./ledger/confirmation", () => ({
  importantAction: () => null,
  useConfirm: () => async () => true,
}));

beforeEach(() => {
  context.revision='first';
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
it('preserves the submitted body/key across a permission revision and ignores replacement form values',async()=>{
 vi.mocked(request).mockRejectedValue({status:0,message:'Network lost'});
 const {result,rerender}=renderHook(()=>useWorkspaceCommand());
 await act(async()=>{const pending=result.current.run('/enterprise-workspace/members',{name:'original'});await vi.advanceTimersByTimeAsync(12000);await pending;});
 const first=vi.mocked(request).mock.calls[0];expect(result.current.frozen).toBe(true);
 context.revision='second';rerender();vi.mocked(request).mockResolvedValueOnce({id:'confirmed'});
 await act(()=>result.current.run('/enterprise-workspace/members',{name:'replacement'}));
 expect(vi.mocked(request).mock.calls.at(-1)).toEqual(first);expect(result.current.frozen).toBe(false);
});
