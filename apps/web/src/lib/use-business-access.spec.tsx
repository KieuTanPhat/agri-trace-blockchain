import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBusinessAccess } from "./use-business-access";
import { request } from "./api-client";
import { getAuthorizationScope } from "./auth-scope";
import { IOT_READING_STORAGE_KEY } from "./iot-local-store";
import { PERMISSION_SYNC_KEY } from "./permission-sync";
import type { AuthUser } from "./types";
vi.mock("./api-client", () => ({ request: vi.fn() }));
const user: AuthUser = {
  id: "one",
  fullName: "One",
  email: "one@example.test",
  accountStatus: "ACTIVE",
  organizationId: "org",
  role: { code: "FARM_STAFF", name: "Producer" },
};
const first = "a".repeat(64),
  second = "b".repeat(64);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(request).mockResolvedValue({ accessRevision: first });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Current business permission refresh", () => {
  it("drops scoped production access on revoke despite an unchanged global farmer role", async () => {
    vi.mocked(request).mockResolvedValueOnce({
      accessRevision: first,
      businessScopeActivated: true,
      productionChains: [{ id: "chain" }],
    });
    const { result } = renderHook(() => useBusinessAccess(user));
    await waitFor(() => expect(result.current.productionAccess).toBe(true));
    vi.mocked(request).mockResolvedValueOnce({
      accessRevision: second,
      businessScopeActivated: true,
      productionChains: [],
    });
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.revision).toBe(second));
    expect(result.current.productionAccess).toBe(false);
  });
  it("keeps the same scope through a focus check and changes it after another tab revokes access", async () => {
    const { result } = renderHook(() => useBusinessAccess(user));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const slow = deferred<{ accessRevision: string }>();
    vi.mocked(request).mockReturnValueOnce(slow.promise);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(result.current.status).toBe("checking");
    expect(result.current.revision).toBe(first);
    await act(async () => slow.resolve({ accessRevision: first }));
    expect(result.current.status).toBe("ready");
    expect(result.current.revision).toBe(first);
    const key = `${IOT_READING_STORAGE_KEY}:${getAuthorizationScope({ ...user, accessRevision: first })}`;
    localStorage.setItem(key, "private readings");
    vi.mocked(request).mockResolvedValueOnce({ accessRevision: second });
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: PERMISSION_SYNC_KEY,
          newValue: "notification-only",
        }),
      ),
    );
    await waitFor(() => expect(result.current.revision).toBe(second));
    expect(localStorage.getItem(key)).toBeNull();
  });
  it("ignores an old account's late permission response", async () => {
    const slow = deferred<{ accessRevision: string }>();
    vi.mocked(request)
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce({ accessRevision: second });
    const { result, rerender } = renderHook(
      ({ actor }) => useBusinessAccess(actor),
      { initialProps: { actor: user } },
    );
    rerender({ actor: { ...user, id: "two" } });
    await waitFor(() => expect(result.current.revision).toBe(second));
    await act(async () => slow.resolve({ accessRevision: first }));
    expect(result.current.revision).toBe(second);
    expect(result.current.identity).toContain("two");
  });
  it("hides private content when current permissions cannot be checked and recovers through focus", async () => {
    const { result } = renderHook(() => useBusinessAccess(user));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    vi.mocked(request).mockRejectedValueOnce(new Error("Unavailable"));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
  it("does not expose a response that completed while the tab was hidden", async () => {
    const slow = deferred<{ accessRevision: string }>();
    vi.mocked(request).mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => useBusinessAccess(user));
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => slow.resolve({ accessRevision: first }));
    expect(result.current.status).toBe("checking");
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });
  it("clears scope cache on logout/unmount and rejects missing revision", async () => {
    const { result, unmount } = renderHook(() => useBusinessAccess(user));
    await waitFor(() => expect(result.current.status).toBe("ready"));
    const key = `${IOT_READING_STORAGE_KEY}:${getAuthorizationScope({ ...user, accessRevision: first })}`;
    localStorage.setItem(key, "private readings");
    unmount();
    expect(localStorage.getItem(key)).toBeNull();
    vi.mocked(request).mockResolvedValueOnce({});
    const invalid = renderHook(() => useBusinessAccess(user));
    await waitFor(() =>
      expect(invalid.result.current.status).toBe("unavailable"),
    );
  });
});
