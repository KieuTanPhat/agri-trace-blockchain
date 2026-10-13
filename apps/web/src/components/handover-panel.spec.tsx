import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { act } from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { HandoverPanel } from "./handover-panel";
import {
  fromBase64Url,
  intentDigest,
  payloadDigest,
  signedMessage,
  toBase64Url,
  type PreparedIntent,
} from "@/lib/signing/canonical";
import { MemoryKeyStore } from "@/lib/signing/key-store";
import { createSigningKey } from "@/lib/signing/signer";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  listPendingCommands: vi.fn().mockResolvedValue([]),
}));
const auth = vi.hoisted(() => ({
  user: {
    id: "one",
    organizationId: "00000000-0000-4000-8000-0000000000a1",
    role: { code: "FARM_STAFF" },
    accountStatus: "ACTIVE",
    accessRevision: "first",
  },
  privateAccessStatus: "ready",
}));
vi.mock("@/lib/api-client", () => api);
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));

const ids = {
  chain: "chain",
  farm: "00000000-0000-4000-8000-0000000000a1",
  carrier: "00000000-0000-4000-8000-0000000000a2",
  retailer: "00000000-0000-4000-8000-0000000000a3",
  shipment: "00000000-0000-4000-8000-0000000000b1",
};
let enrolled: Array<{
  keyRef: string;
  label: string;
  publicKey: string;
  organizationId: string;
  status: string;
}> = [];
let roles = ["FARM_STAFF", "TRANSPORTER", "RETAILER"];
function mockRequests(handler: (path: string, init?: RequestInit) => unknown) {
  api.request.mockImplementation((path: string, init?: RequestInit) => {
    if (path === "/chain-permissions")
      return Promise.resolve({
        businessChains: [ids.chain],
        memberships: [
          {
            chainId: ids.chain,
            organizationId: auth.user.organizationId,
            status: "ACTIVE",
          },
        ],
        capabilities: ["FARM", "TRANSPORTER", "RETAILER"].map((code) => ({
          organizationId: auth.user.organizationId,
          code,
          revokedAt: null,
        })),
        grants: roles.map((role) => ({
          chainId: ids.chain,
          organizationId: auth.user.organizationId,
          role,
          scope: "CHAIN",
          revokedAt: null,
        })),
      });
    if (path.endsWith("/signing-keys"))
      return Promise.resolve({
        chainId: ids.chain,
        chainRef: "00000000-0000-4000-8000-0000000000f1",
        organizationId: auth.user.organizationId,
        bindingDigest: "ab".repeat(32),
        handoverMode: "DUAL_SIGNED",
        keys: enrolled.filter(
          (key) => key.organizationId === auth.user.organizationId,
        ),
      });
    return Promise.resolve(handler(path, init));
  });
}
const handover = (overrides: Record<string, unknown> = {}) => ({
  id: "00000000-0000-4000-8000-0000000000c1",
  shipmentId: ids.shipment,
  chainId: "chain",
  kind: "PICKUP",
  state: "OFFERED",
  giverOrgId: ids.farm,
  receiverOrgId: ids.carrier,
  custodyLabel: "CROSS_ORG",
  quantity: "2.000",
  unit: "kg",
  shipmentVersion: 0,
  lotVersion: 0,
  note: null,
  reason: null,
  offerEventId: "00000000-0000-4000-8000-0000000000d1",
  resolveEventId: null,
  offeredAt: "2026-10-13T00:00:00.000Z",
  expiresAt: "2099-10-14T00:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto);
});
beforeEach(() => {
  auth.user = {
    id: "one",
    organizationId: ids.farm,
    role: { code: "FARM_STAFF" },
    accountStatus: "ACTIVE",
    accessRevision: "first",
  };
  auth.privateAccessStatus = "ready";
  enrolled = [];
  roles = ["FARM_STAFF", "TRANSPORTER", "RETAILER"];
  api.listPendingCommands.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  api.request.mockReset();
});

/** A prepared intent the way the API would return it for the given key. */
async function preparedFor(
  keyRef: string,
  overrides: { payload?: Record<string, string> } = {},
): Promise<PreparedIntent> {
  const payload = {
    handoverId: handover().id,
    shipmentId: ids.shipment,
    giverOrgId: ids.farm,
    receiverOrgId: ids.carrier,
    kind: "PICKUP",
    quantity: "2.000",
    unit: "kg",
    shipmentVersion: "0",
    offerExpiresAt: "2099-10-14T00:00:00.000Z",
    note: "",
    ...overrides.payload,
  };
  const notAfter = new Date(Date.now() + 15 * 60_000).toISOString();
  const intent = {
    protocol: "agritrace-intent/1",
    intentId: "00000000-0000-4000-8000-0000000000e1",
    chainRef: "00000000-0000-4000-8000-0000000000f1",
    bindingDigest: "ab".repeat(32),
    signerOrgRef: ids.farm,
    keyRef,
    operation: "HANDOVER_OFFER",
    entityType: "SHIPMENT",
    entityId: ids.shipment,
    eventId: "00000000-0000-4000-8000-0000000000e2",
    eventType: "HANDOVER_OFFERED",
    expectedVersion: "0",
    payloadDigest: await payloadDigest(payload),
    notAfter,
    policyVersion: "1",
  };
  return {
    intentId: intent.intentId,
    operation: intent.operation,
    keyRef,
    expiresAt: notAfter,
    intent,
    payload,
    intentDigest: await intentDigest(intent),
    signedMessage: toBase64Url(await signedMessage(intent)),
  };
}

async function newKey(store: MemoryKeyStore) {
  const key = await createSigningKey(store, {
    chainId: "chain",
    organizationId: ids.farm,
    bindingDigest: "ab".repeat(32),
    label: "Thiết bị văn phòng",
  });
  enrolled.push({ ...key, organizationId: ids.farm, status: "ACTIVE" });
  return key;
}

const view = (
  overrides: Partial<React.ComponentProps<typeof HandoverPanel>> = {},
) => {
  const store = new MemoryKeyStore();
  if (overrides.organizationId)
    auth.user.organizationId = overrides.organizationId;
  render(
    <HandoverPanel
      chainId={ids.chain}
      shipmentId={ids.shipment}
      status="CREATED"
      organizationId={ids.farm}
      farmOrgId={ids.farm}
      transporterOrgId={ids.carrier}
      retailerOrgId={ids.retailer}
      keyStore={store}
      {...overrides}
    />,
  );
  return store;
};

describe("HandoverPanel", () => {
  it("lets the producer offer a pickup, review what it signs, and submits only the signature", async () => {
    const store = new MemoryKeyStore();
    const created = await newKey(store);
    const prepared = await preparedFor(created.keyRef, {
      payload: { note: "Giao buổi sáng" },
    });
    mockRequests(async (path: string) => {
      if (path.endsWith("/handovers")) return [];
      if (path.endsWith("/handover-offers/intent")) return prepared;
      return {};
    });
    render(
      <HandoverPanel
        chainId={ids.chain}
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
        retailerOrgId={ids.retailer}
        keyStore={store}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Đề nghị bàn giao/ }),
    );
    expect(await screen.findByText(/Bạn sắp ký và gửi/)).toBeTruthy();
    expect(screen.getByText("2.000 kg")).toBeTruthy();
    expect(screen.getByText("Giao buổi sáng")).toBeTruthy();
    const preparing = api.request.mock.calls.find(([path]) =>
      String(path).endsWith("/handover-offers/intent"),
    );
    expect(JSON.parse(preparing![1].body)).toEqual({
      kind: "PICKUP",
      keyRef: created.keyRef,
      preparationRef: expect.any(String),
    });

    fireEvent.click(screen.getByRole("button", { name: "Ký và gửi" }));
    await waitFor(() =>
      expect(
        api.request.mock.calls.some(([path]) =>
          String(path).endsWith(`/signing-intents/${prepared.intentId}/submit`),
        ),
      ).toBe(true),
    );
    const submit = api.request.mock.calls.find(([path]) =>
      String(path).endsWith("/submit"),
    )!;
    const body = JSON.parse(submit[1].body) as { signature: string };
    expect(Object.keys(body)).toEqual(["signature"]);
    // The signature is a valid Ed25519 signature of the exact signed message.
    const stored = (await store.get(created.keyRef))!;
    const publicKey = await webcrypto.subtle.importKey(
      "spki",
      fromBase64Url(stored.publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    expect(
      await webcrypto.subtle.verify(
        { name: "Ed25519" },
        publicKey,
        fromBase64Url(body.signature),
        await signedMessage(prepared.intent),
      ),
    ).toBe(true);
    expect(submit[1].headers["idempotency-key"]).toBeTruthy();
  });

  it("refuses to sign when the server changes the content after it was shown", async () => {
    const store = new MemoryKeyStore();
    const created = await newKey(store);
    const honest = await preparedFor(created.keyRef);
    // The digest in the intent still names the original payload.
    const tampered = {
      ...honest,
      payload: { ...honest.payload, quantity: "900.000" },
    };
    mockRequests(async (path: string) => {
      if (path.endsWith("/handovers")) return [];
      if (path.endsWith("/handover-offers/intent")) return tampered;
      return {};
    });
    render(
      <HandoverPanel
        chainId={ids.chain}
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
        retailerOrgId={ids.retailer}
        keyStore={store}
      />,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Đề nghị bàn giao/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Ký và gửi" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /không khớp nội dung sẽ ký/,
    );
    expect(
      api.request.mock.calls.some(([path]) => String(path).endsWith("/submit")),
    ).toBe(false);
  });

  it("shows the receiver confirm and reject, the giver cancel, and nothing to others", async () => {
    mockRequests(() => [handover()]);
    view({ organizationId: ids.carrier });
    expect(
      await screen.findByRole("button", { name: "Xác nhận nhận hàng" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Từ chối" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hủy đề nghị" })).toBeNull();
    cleanup();

    view({ organizationId: ids.farm });
    expect(
      await screen.findByRole("button", { name: "Hủy đề nghị" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Xác nhận nhận hàng" }),
    ).toBeNull();
    expect(screen.queryByRole("form", { name: "Đề nghị bàn giao" })).toBeNull();
    cleanup();

    view({ organizationId: ids.retailer });
    await screen.findByText(/Đang chờ bên nhận xác nhận/);
    expect(
      screen.queryByRole("button", { name: /xác nhận|Hủy|Từ chối/i }),
    ).toBeNull();
  });

  it("labels same-organization handovers and keeps resolved ones read-only", async () => {
    mockRequests(() => [
      handover({
        state: "CONFIRMED",
        custodyLabel: "INTERNAL_SAME_ORG",
        receiverOrgId: ids.farm,
      }),
      handover({
        id: "00000000-0000-4000-8000-0000000000c2",
        state: "REJECTED",
        reason: "xe chưa sẵn sàng",
      }),
    ]);
    view({ status: "IN_TRANSIT", organizationId: ids.carrier });
    expect(await screen.findByText(/bàn giao nội bộ/)).toBeTruthy();
    expect(screen.getByText(/xe chưa sẵn sàng/)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /Xác nhận nhận hàng/ }),
    ).toBeNull();
  });

  it("offers the arrival handover to the transporter of an in-transit shipment", async () => {
    mockRequests(() => []);
    view({ status: "IN_TRANSIT", organizationId: ids.carrier });
    expect(
      await screen.findByRole("button", {
        name: /Giao hàng cho đơn vị bán lẻ/i,
      }),
    ).toBeTruthy();
  });
  it("requires explicit keyRef when multiple active organization keys exist", async () => {
    const store = new MemoryKeyStore();
    await newKey(store);
    const chosen = await newKey(store);
    enrolled[0].label = "Khóa cũ";
    enrolled[1].label = "Khóa mới";
    const prepared = await preparedFor(chosen.keyRef);
    mockRequests((path) =>
      path.endsWith("/handover-offers/intent") ? prepared : [],
    );
    render(
      <HandoverPanel
        chainId={ids.chain}
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
        retailerOrgId={ids.retailer}
        keyStore={store}
      />,
    );
    const selector = await screen.findByLabelText("Khóa ký cho bàn giao");
    expect(selector).toHaveValue("");
    expect(
      screen.getByRole("button", { name: /Đề nghị bàn giao/ }),
    ).toBeDisabled();
    fireEvent.change(selector, { target: { value: chosen.keyRef } });
    fireEvent.click(screen.getByRole("button", { name: /Đề nghị bàn giao/ }));
    await screen.findByText(/Bạn sắp ký và gửi/);
    const call = api.request.mock.calls.find(([path]) =>
      String(path).endsWith("/handover-offers/intent"),
    )!;
    expect(JSON.parse(call[1].body).keyRef).toBe(chosen.keyRef);
    expect(screen.getByText("Khóa mới")).toBeTruthy();
  });
  it("keeps the reviewed offer validity within the API's 15-minute minimum", async () => {
    const store = new MemoryKeyStore();
    const created = await newKey(store);
    const prepared = await preparedFor(created.keyRef);
    mockRequests((path) =>
      path.endsWith("/handover-offers/intent") ? prepared : [],
    );
    render(
      <HandoverPanel
        chainId={ids.chain}
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
        retailerOrgId={ids.retailer}
        keyStore={store}
      />,
    );
    const duration = await screen.findByLabelText("Hiệu lực đề nghị (phút)");
    expect(duration).toHaveAttribute("min", "15");
    expect(duration).toHaveValue(1440);
    fireEvent.change(duration, { target: { value: "14" } });
    fireEvent.submit(screen.getByRole("form", { name: "Đề nghị bàn giao" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /15 đến 10080/,
    );
    expect(
      api.request.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
    fireEvent.change(duration, { target: { value: "15" } });
    fireEvent.submit(screen.getByRole("form", { name: "Đề nghị bàn giao" }));
    await screen.findByText(/Bạn sắp ký và gửi/);
    const call = api.request.mock.calls.find(([path]) =>
      String(path).endsWith("/handover-offers/intent"),
    )!;
    expect(JSON.parse(call[1].body).offerValidMinutes).toBe(15);
  });
  it("drops a late prepared intent after account or permission scope changes", async () => {
    const store = new MemoryKeyStore();
    const created = await newKey(store);
    const prepared = await preparedFor(created.keyRef);
    let finish!: (value: PreparedIntent) => void;
    mockRequests((path) =>
      path.endsWith("/handover-offers/intent")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : [],
    );
    const props = {
      chainId: ids.chain,
      shipmentId: ids.shipment,
      status: "CREATED",
      organizationId: ids.farm,
      farmOrgId: ids.farm,
      transporterOrgId: ids.carrier,
      retailerOrgId: ids.retailer,
      keyStore: store,
    };
    const shown = render(<HandoverPanel {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Đề nghị bàn giao/ }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    auth.user = {
      ...auth.user,
      id: "new-account",
      accessRevision: "new-permissions",
    };
    shown.rerender(<HandoverPanel {...props} />);
    await act(async () => finish(prepared));
    expect(
      screen.queryByRole("region", { name: "Xem lại trước khi ký" }),
    ).toBeNull();
    expect(
      api.request.mock.calls.some(([path]) => String(path).endsWith("/submit")),
    ).toBe(false);
  });
  it("removes signing review and all command buttons after the current chain grant is revoked", async () => {
    const store = new MemoryKeyStore();
    const created = await newKey(store);
    const prepared = await preparedFor(created.keyRef);
    mockRequests((path) =>
      path.endsWith("/handover-offers/intent") ? prepared : [],
    );
    const props = {
      chainId: ids.chain,
      shipmentId: ids.shipment,
      status: "CREATED",
      organizationId: ids.farm,
      farmOrgId: ids.farm,
      transporterOrgId: ids.carrier,
      retailerOrgId: ids.retailer,
      keyStore: store,
    };
    const shown = render(<HandoverPanel {...props} />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Đề nghị bàn giao/ }),
    );
    await screen.findByRole("button", { name: "Ký và gửi" });
    roles = [];
    auth.user.accessRevision = "revoked";
    shown.rerender(<HandoverPanel {...props} />);
    await screen.findByText("Chưa có đề nghị bàn giao.");
    expect(screen.queryByRole("button", { name: "Ký và gửi" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Đề nghị bàn giao/ }),
    ).toBeNull();
  });
  it("holds a new offer across remount while an original signed submission remains unresolved", async () => {
    const store = new MemoryKeyStore();
    await newKey(store);
    api.listPendingCommands.mockResolvedValue([
      { id: "saved-signature", operation: "SUBMIT_SIGNED_INTENT" },
    ]);
    mockRequests(() => []);
    const props = {
      chainId: ids.chain,
      shipmentId: ids.shipment,
      status: "CREATED",
      organizationId: ids.farm,
      farmOrgId: ids.farm,
      transporterOrgId: ids.carrier,
      retailerOrgId: ids.retailer,
      keyStore: store,
    };
    const first = render(<HandoverPanel {...props} />);
    expect(
      await screen.findByRole("button", { name: /Đề nghị bàn giao/ }),
    ).toBeDisabled();
    first.unmount();
    render(<HandoverPanel {...props} />);
    const button = await screen.findByRole("button", {
      name: /Đề nghị bàn giao/,
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(
      api.request.mock.calls.some(([, init]) => init?.method === "POST"),
    ).toBe(false);
  });
  it("labels an offered same-org confirmation as internal", async () => {
    mockRequests(() => [
      handover({ custodyLabel: "INTERNAL_SAME_ORG", receiverOrgId: ids.farm }),
    ]);
    view({ transporterOrgId: ids.farm });
    expect(
      await screen.findByRole("button", { name: "Xác nhận nhận hàng nội bộ" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Xác nhận nhận hàng" }),
    ).toBeNull();
  });
});
