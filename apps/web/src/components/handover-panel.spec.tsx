import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);

const ids = {
  farm: "00000000-0000-4000-8000-0000000000a1",
  carrier: "00000000-0000-4000-8000-0000000000a2",
  retailer: "00000000-0000-4000-8000-0000000000a3",
  shipment: "00000000-0000-4000-8000-0000000000b1",
};
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
  return createSigningKey(store, {
    chainId: "chain",
    organizationId: ids.farm,
    bindingDigest: "ab".repeat(32),
    label: "Thiết bị văn phòng",
  });
}

const view = (
  overrides: Partial<React.ComponentProps<typeof HandoverPanel>> = {},
) => {
  const store = new MemoryKeyStore();
  render(
    <HandoverPanel
      shipmentId={ids.shipment}
      status="CREATED"
      organizationId={ids.farm}
      farmOrgId={ids.farm}
      transporterOrgId={ids.carrier}
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
    api.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/handovers")) return [];
      if (path.endsWith("/handover-offers/intent")) return prepared;
      return {};
    });
    render(
      <HandoverPanel
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
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
    expect(JSON.parse(preparing![1].body)).toEqual({ kind: "PICKUP" });

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
    api.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/handovers")) return [];
      if (path.endsWith("/handover-offers/intent")) return tampered;
      return {};
    });
    render(
      <HandoverPanel
        shipmentId={ids.shipment}
        status="CREATED"
        organizationId={ids.farm}
        farmOrgId={ids.farm}
        transporterOrgId={ids.carrier}
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
    api.request.mockResolvedValue([handover()]);
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
    expect(screen.queryByRole("button", { name: "Xác nhận nhận hàng" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Đề nghị bàn giao" })).toBeNull();
    cleanup();

    view({ organizationId: ids.retailer });
    await screen.findByText(/Đang chờ bên nhận xác nhận/);
    expect(screen.queryByRole("button", { name: /xác nhận|Hủy|Từ chối/i })).toBeNull();
  });

  it("labels same-organization handovers and keeps resolved ones read-only", async () => {
    api.request.mockResolvedValue([
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
    expect(screen.queryByRole("button", { name: /Xác nhận nhận hàng/ })).toBeNull();
  });

  it("offers the arrival handover to the transporter of an in-transit shipment", async () => {
    api.request.mockResolvedValue([]);
    view({ status: "IN_TRANSIT", organizationId: ids.carrier });
    expect(
      await screen.findByRole("button", { name: /Giao hàng cho đơn vị bán lẻ/i }),
    ).toBeTruthy();
  });
});
