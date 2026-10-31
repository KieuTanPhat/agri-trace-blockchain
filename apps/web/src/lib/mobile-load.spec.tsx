import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResource } from "../../../mobile/src/lib/use-resource";

const auth = { scope: "staff:session-a" };
function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[] = [],
) {
  return useResource(load, auth.scope, deps);
}
afterEach(() => {
  cleanup();
  auth.scope = "staff:session-a";
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("Mobile resource isolation", () => {
  it("hides the old route immediately and ignores its late response", async () => {
    const old = deferred<string>(),
      next = deferred<string>();
    const read = vi.fn((id: string) =>
      id === "a" ? old.promise : next.promise,
    );
    const { result, rerender } = renderHook(
      ({ id }) => useLoad(() => read(id), [id]),
      { initialProps: { id: "a" } },
    );
    await waitFor(() => expect(read).toHaveBeenCalledWith("a"));
    rerender({ id: "b" });
    expect(result.current.data).toBeNull();
    await act(async () => {
      next.resolve("route-b");
    });
    expect(result.current.data).toBe("route-b");
    await act(async () => {
      old.resolve("private-route-a");
    });
    expect(result.current.data).toBe("route-b");
  });
  it("invalidates visible data and pending reads when the session changes", async () => {
    const pending = deferred<string>();
    let response = Promise.resolve("account-a");
    const { result, rerender } = renderHook(() => useLoad(() => response));
    await waitFor(() => expect(result.current.data).toBe("account-a"));
    response = pending.promise;
    auth.scope = "staff:session-b";
    rerender();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);
    await act(async () => {
      pending.resolve("account-b");
    });
    expect(result.current.data).toBe("account-b");
  });
  it("uses the latest committed loader for an explicit reload without a render ref write", async () => {
    const { result, rerender } = renderHook(
      ({ value }) => useLoad(async () => value),
      { initialProps: { value: "first" } },
    );
    await waitFor(() => expect(result.current.data).toBe("first"));
    rerender({ value: "updated" });
    await act(() => result.current.reload());
    expect(result.current.data).toBe("updated");
  });
  it("does not replace a successful newer reload with an older failure", async () => {
    const old = deferred<string>();
    let response = old.promise;
    const read = vi.fn(() => response);
    const { result, rerender } = renderHook(() => useLoad(read));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    response = Promise.resolve("newest");
    rerender();
    await act(() => result.current.reload());
    await act(async () => {
      old.reject(new Error("old network failure"));
    });
    expect(result.current.data).toBe("newest");
    expect(result.current.error).toBeNull();
  });
  it("ignores a delayed local update captured by the previous account", async () => {
    const { result, rerender } = renderHook(() =>
      useLoad(async () => auth.scope),
    );
    await waitFor(() => expect(result.current.data).toBe("staff:session-a"));
    const updateOldAccount = result.current.setData;
    auth.scope = "staff:session-b";
    rerender();
    await waitFor(() => expect(result.current.data).toBe("staff:session-b"));
    act(() => updateOldAccount("private data from account-a"));
    expect(result.current.data).toBe("staff:session-b");
  });
});
