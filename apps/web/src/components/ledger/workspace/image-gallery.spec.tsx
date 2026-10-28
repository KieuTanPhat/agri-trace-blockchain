import { renderHook, waitFor } from "@testing-library/react";
import { webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { useEvidenceObjectUrl } from "./image-gallery";
const file = { mediaType: "image/png", fileName: "private.png", contentBase64: "YWJj", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("never exposes content when the authorized response fails its evidence hash", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const create = vi.fn(() => "blob:private");
  vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
  const invalid = { ...file, sha256: "0".repeat(64) };
  const { result } = renderHook(() => useEvidenceObjectUrl(invalid));
  await waitFor(() => expect(result.current.error?.message).toMatch(/khớp hash/));
  expect(result.current.url).toBeUndefined();
  expect(create).not.toHaveBeenCalled();
});
it("removes the previous private URL immediately and revokes it when its view closes", async () => {
  vi.stubGlobal("crypto", webcrypto);
  const revoke = vi.fn();
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:private"), revokeObjectURL: revoke });
  const { result, rerender, unmount } = renderHook(({ content }) => useEvidenceObjectUrl(content), { initialProps: { content: file as typeof file | undefined } });
  await waitFor(() => expect(result.current.url).toBe("blob:private"));
  rerender({ content: undefined });
  expect(result.current.url).toBeUndefined();
  expect(revoke).toHaveBeenCalledWith("blob:private");
  unmount();
});
