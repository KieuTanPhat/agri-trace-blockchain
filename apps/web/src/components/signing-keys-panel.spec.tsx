import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SigningKeysPanel } from "./signing-keys-panel";
import { fromBase64Url, keyPopMessage } from "@/lib/signing/canonical";
import { MemoryKeyStore } from "@/lib/signing/key-store";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);

const org = "00000000-0000-4000-8000-0000000000a1";
const binding = "ab".repeat(32);
const key = (overrides: Record<string, unknown> = {}) => ({
  keyRef: "00000000-0000-4000-8000-000000000001",
  chainId: "chain",
  organizationId: org,
  label: "Máy tính văn phòng",
  algorithm: "Ed25519",
  publicKey: "A".repeat(59),
  status: "ACTIVE",
  createdAt: "2026-10-13T00:00:00.000Z",
  activatedAt: "2026-10-13T00:05:00.000Z",
  revokedAt: null,
  ...overrides,
});
const context = (keys: unknown[], bindingDigest: string | null = binding) => ({
  chainId: "chain",
  organizationId: org,
  bindingDigest,
  handoverMode: "DUAL_SIGNED",
  keys,
});

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => {
  cleanup();
  api.request.mockReset();
});

const show = (admin: boolean, store = new MemoryKeyStore()) => {
  render(
    <SigningKeysPanel
      chainId="chain"
      organizationId={org}
      orgAdmin={admin}
      keyStore={store}
    />,
  );
  return store;
};

describe("SigningKeysPanel", () => {
  it("lists keys with their ledger status and whether the private key is on this device", async () => {
    const store = new MemoryKeyStore();
    api.request.mockResolvedValue(
      context([
        key(),
        key({
          keyRef: "00000000-0000-4000-8000-000000000002",
          label: "Khóa mới",
          status: "PENDING_LEDGER",
          activatedAt: null,
        }),
      ]),
    );
    show(false, store);
    expect(await screen.findByText("Máy tính văn phòng")).toBeTruthy();
    expect(screen.getByText(/Chờ kích hoạt trên ledger/)).toBeTruthy();
    expect(screen.getByText(/Đang hoạt động/)).toBeTruthy();
    expect(screen.getAllByText(/khóa riêng không có trên thiết bị này/)).toHaveLength(2);
    // A member without ORG_ADMIN can read but not manage keys.
    expect(screen.queryByRole("form", { name: "Tạo khóa ký" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Thu hồi" })).toBeNull();
  });

  it("creates the key on the device, proves possession and never sends the private key", async () => {
    api.request.mockImplementation(async (path: string, init?: RequestInit) =>
      init?.method === "POST" ? { ok: true } : context([]),
    );
    const store = show(true);
    fireEvent.change(await screen.findByLabelText("Tên khóa"), {
      target: { value: "Laptop kế toán" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Tạo khóa ký trên thiết bị này" }),
    );
    await waitFor(() =>
      expect(
        api.request.mock.calls.some(([, init]) => init?.method === "POST"),
      ).toBe(true),
    );
    const post = api.request.mock.calls.find(
      ([, init]) => init?.method === "POST",
    )!;
    expect(post[0]).toBe("/supply-chains/chain/signing-keys");
    const body = JSON.parse(post[1].body) as {
      keyRef: string;
      label: string;
      publicKey: string;
      popSignature: string;
    };
    expect(Object.keys(body).sort()).toEqual([
      "keyRef",
      "label",
      "popSignature",
      "publicKey",
    ]);
    expect(body.label).toBe("Laptop kế toán");
    // The private key stays in the device store.
    const stored = await store.get(body.keyRef);
    expect(stored?.publicKey).toBe(body.publicKey);
    // The proof verifies for this binding, key reference and organization.
    const publicKey = await webcrypto.subtle.importKey(
      "spki",
      fromBase64Url(body.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        fromBase64Url(body.popSignature),
        keyPopMessage({
          bindingDigest: binding,
          keyRef: body.keyRef,
          orgRef: org,
          publicKey: body.publicKey,
        }),
      ),
    ).toBe(true);
    expect(await screen.findByText(/vận hành viên kích hoạt/)).toBeTruthy();
  });

  it("drops the local private key when the API refuses the enrollment", async () => {
    api.request.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("Khóa này đã được đăng ký");
      return context([]);
    });
    const store = show(true);
    fireEvent.change(await screen.findByLabelText("Tên khóa"), {
      target: { value: "Trùng" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Tạo khóa ký trên thiết bị này" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Khóa này đã được đăng ký",
    );
    expect(await store.list("chain", org)).toHaveLength(0);
  });

  it("revokes a key with a reason", async () => {
    api.request.mockImplementation(async (_path: string, init?: RequestInit) =>
      init?.method === "POST" ? {} : context([key()]),
    );
    show(true);
    fireEvent.click(await screen.findByRole("button", { name: "Thu hồi" }));
    fireEvent.change(screen.getByLabelText("Lý do thu hồi"), {
      target: { value: "mất thiết bị" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Xác nhận thu hồi" }));
    await waitFor(() =>
      expect(
        api.request.mock.calls.some(([path]) => String(path).endsWith("/revoke")),
      ).toBe(true),
    );
    const call = api.request.mock.calls.find(([path]) =>
      String(path).endsWith("/revoke"),
    )!;
    expect(JSON.parse(call[1].body)).toEqual({ reason: "mất thiết bị" });
  });

  it("explains a chain without its own ledger binding", async () => {
    api.request.mockResolvedValue({ ...context([], null), handoverMode: "STANDARD" });
    show(true);
    expect(await screen.findByText(/chưa có kết nối ledger riêng/)).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Tạo khóa ký" })).toBeNull();
  });
});
