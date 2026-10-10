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
} from "@/lib/api-client";
import { HarvestDialog } from "./harvest-dialog";

const { user } = vi.hoisted(() => ({
  user: {
    id: "87247bd2-c19b-4f9c-ab44-fd2ea5f96fa",
    role: { code: "FARM_STAFF" },
    organizationId: "173f44c2-06ef-4221-8c75-f68e292415b0",
    accountStatus: "ACTIVE",
  },
}));
vi.mock("@/lib/api-client", () => ({
  getHarvestRequestStatus: vi.fn(),
  getProductionCycles: vi.fn(),
  readSession: vi.fn(),
  recordHarvest: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => ({ user }) }));
vi.mock("./qr-code-card", () => ({
  QrCodeCard: ({ value }: { value: string }) => <span>{value}</span>,
}));
const cycleId = "59c1b564-2736-4ea7-bdb5-701e20423f23";
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
  vi.mocked(readSession).mockReturnValue({ user } as never);
  vi.mocked(getHarvestRequestStatus).mockResolvedValue({ status: "NOT_FOUND" });
  vi.mocked(getProductionCycles).mockResolvedValue([
    {
      id: cycleId,
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
  fireEvent.change(screen.getByLabelText("Số lượng"), {
    target: { value: "10" },
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
