import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  getHarvestRequestStatus,
  getProductionCycles,
  readSession,
  recordHarvest,
  request,
} from "@/lib/api-client";
import { acceptBusinessAccessRevision } from "@/lib/permission-sync";
import { HarvestDialog } from "./harvest-dialog";

const { user, auth } = vi.hoisted(() => {
  const user = {
    id: "87247bd2-c19b-4f9c-ab44-fd2ea5f96fa0",
    role: { code: "FARM_STAFF" },
    organizationId: "173f44c2-06ef-4221-8c75-f68e292415b0",
    accountStatus: "ACTIVE",
  };
  // useAuth() decorates the raw session user like AuthProvider does.
  return { user, auth: { user: user as typeof user & { accessRevision?: string } } };
});
vi.mock("@/lib/api-client", () => ({
  getHarvestRequestStatus: vi.fn(),
  getProductionCycles: vi.fn(),
  readSession: vi.fn(),
  recordHarvest: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
vi.mock("./qr-code-card", () => ({
  QrCodeCard: ({ value }: { value: string }) => <span>{value}</span>,
}));
const cycleId = "59c1b564-2736-4ea7-bdb5-701e20423f23";
const harvestEvidenceId = "b42eb5f4-b7c2-4d68-84b7-4f42fe0a0021";
const lotEvidenceId = "f8c20f73-d564-47de-a183-48ee75db763b";
const result = {
  lot: { id: "ad2fbfe8-5837-40db-b8f7-d22cfae5fba2", lotCode: "AUTO-1" },
  traceQr: { traceToken: "restored-qr" },
};

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  vi.stubGlobal("crypto", webcrypto);
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (_name: string, operation: () => Promise<unknown>) =>
        operation(),
    },
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  auth.user = user;
  vi.mocked(readSession).mockReturnValue({ user } as never);
  vi.mocked(getHarvestRequestStatus).mockResolvedValue({ status: "NOT_FOUND" });
  vi.mocked(request).mockResolvedValue({
    items: [
      {
        id: harvestEvidenceId,
        kind: "HARVEST_IMAGE",
        fileName: "harvest.jpg",
        supersedesId: null,
      },
      {
        id: lotEvidenceId,
        kind: "LOT_IMAGE",
        fileName: "lot.jpg",
        supersedesId: null,
      },
    ],
  } as never);
  vi.mocked(getProductionCycles).mockResolvedValue([
    {
      id: cycleId,
      version: 0,
      cycleCode: "CYCLE-1",
      currentState: "GROWING",
      harvestUnit: "kg",
      product: { productName: "Rice", defaultUnit: "kg" },
      farm: { name: "Farm" },
    },
  ] as never);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function enterHarvest(container: HTMLElement) {
  fireEvent.click(screen.getByRole("button", { name: "Ghi nhận thu hoạch" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Tạo lô từ thu hoạch" }),
    ).toBeEnabled(),
  );
  await screen.findByRole("option", { name: /CYCLE-1/ });
  fireEvent.change(screen.getByLabelText("Chu kỳ sản xuất"), {
    target: { value: cycleId },
  });
  await screen.findByRole("option", { name: "harvest.jpg" });
  await screen.findByRole("option", { name: "lot.jpg" });
  fireEvent.change(screen.getByLabelText("Số lượng"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Tên lô nông sản"), {
    target: { value: "Harvest lot" },
  });
  fireEvent.change(screen.getByLabelText("Ảnh thu hoạch"), {
    target: { value: harvestEvidenceId },
  });
  fireEvent.change(screen.getByLabelText("Ảnh lô nông sản"), {
    target: { value: lotEvidenceId },
  });
  fireEvent.submit(container.querySelector("form")!);
}

it("restores the existing Lot and QR after an uncertain response and component remount", async () => {
  vi.mocked(recordHarvest).mockRejectedValue(new Error("response lost"));
  const first = render(<HarvestDialog onCreated={() => undefined} />);
  await enterHarvest(first.container);
  await screen.findByText(/Nhập lại đúng nội dung/);
  expect(recordHarvest).toHaveBeenCalledTimes(1);
  first.unmount();
  vi.mocked(getHarvestRequestStatus).mockResolvedValue({
    status: "COMMITTED",
    result,
  });
  render(<HarvestDialog onCreated={() => undefined} />);
  expect(await screen.findByText("Đã tạo lô AUTO-1")).toBeVisible();
  expect(screen.getByRole("link", { name: "Xem lô vừa tạo" })).toHaveAttribute(
    "href",
    "/lots/" + result.lot.id,
  );
  expect(screen.getByText(/restored-qr/)).toBeVisible();
  expect(recordHarvest).toHaveBeenCalledTimes(1);
});

it("keeps the original key and time when the same fields are re-entered after remount", async () => {
  vi.mocked(recordHarvest).mockRejectedValueOnce(
    new Error("request was not delivered"),
  );
  const first = render(<HarvestDialog onCreated={() => undefined} />);
  await enterHarvest(first.container);
  await screen.findByText(/Nhập lại đúng nội dung/);
  first.unmount();
  vi.mocked(recordHarvest).mockResolvedValue(result as never);
  const second = render(<HarvestDialog onCreated={() => undefined} />);
  await enterHarvest(second.container);
  await screen.findByText("Đã tạo lô AUTO-1");
  expect(vi.mocked(recordHarvest).mock.calls[1]).toEqual(
    vi.mocked(recordHarvest).mock.calls[0],
  );
});

it("submits when useAuth carries the accepted permission revision and the session user does not", async () => {
  const revision = "a".repeat(64);
  acceptBusinessAccessRevision(revision);
  auth.user = { ...user, accessRevision: revision };
  vi.mocked(recordHarvest).mockResolvedValue(result as never);
  const view = render(<HarvestDialog onCreated={() => undefined} />);
  await enterHarvest(view.container);
  expect(await screen.findByText("Đã tạo lô AUTO-1")).toBeVisible();
  expect(recordHarvest).toHaveBeenCalledTimes(1);
});

it("refuses to send after the permission revision changed under an open dialog", async () => {
  const revision = "b".repeat(64);
  acceptBusinessAccessRevision(revision);
  auth.user = { ...user, accessRevision: revision };
  const view = render(<HarvestDialog onCreated={() => undefined} />);
  acceptBusinessAccessRevision("c".repeat(64));
  await enterHarvest(view.container);
  expect(await screen.findByText(/quyền đã thay đổi/)).toBeVisible();
  expect(recordHarvest).not.toHaveBeenCalled();
});
