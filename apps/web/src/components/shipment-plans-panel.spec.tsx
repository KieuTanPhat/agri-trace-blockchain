import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShipmentPlansPanel } from "./shipment-plans-panel";
import type { components } from "@/lib/generated/api";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);
const plan = (
  id: string,
  chainId = "chain-one",
): components["schemas"]["ShipmentPlanRecordDto"] => ({
  id,
  chainId,
  lotId: "lot",
  currentRevision: 2,
  version: 2,
  status: "DRAFT",
  shipmentId: null,
  createdAt: "2026-10-12T00:00:00Z",
  current: {
    revision: 2,
    producerOrgId: "producer",
    transporterOrgId: "carrier",
    retailerOrgId: "retailer",
    quantity: "5.000",
    unit: "kg",
    origin: id,
    destination: "shop",
    vehicleRef: null,
    plannedPickupTime: null,
    expectedArrivalTime: null,
    payloadDigest: "a".repeat(64),
    acceptances: [],
  },
});
const props = {
  chainId: "chain-one",
  organizationId: "carrier",
  manager: false,
  orgAdmin: true,
  organizations: [{ value: "carrier", label: "Vận chuyển" }],
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Shipment plan consent and scope isolation", () => {
  it("shows only the organization's own confirmation and sends its exact revision/digest", async () => {
    api.request.mockResolvedValue([plan("old-plan")]);
    render(<ShipmentPlansPanel {...props} />);
    const confirm = await screen.findByRole("button", {
      name: "Xác nhận vai trò vận chuyển",
    });
    expect(
      screen.queryByRole("button", { name: "Xác nhận vai trò sản xuất" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Xác nhận vai trò bán lẻ" }),
    ).not.toBeInTheDocument();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.request).toHaveBeenCalledWith(
        "/supply-chains/chain-one/shipment-plans/old-plan/accept",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            party: "TRANSPORTER",
            revision: 2,
            payloadDigest: "a".repeat(64),
          }),
          headers: { "idempotency-key": expect.any(String) },
        }),
      ),
    );
  });

  it("discards a slow prior-chain result after changing chain", async () => {
    let resolve!: (records: ReturnType<typeof plan>[]) => void;
    const slow = new Promise<ReturnType<typeof plan>[]>((done) => {
      resolve = done;
    });
    api.request.mockImplementation((path: string) =>
      path.includes("chain-one")
        ? slow
        : Promise.resolve([plan("new-plan", "chain-two")]),
    );
    const view = render(<ShipmentPlansPanel {...props} />);
    view.rerender(<ShipmentPlansPanel {...props} chainId="chain-two" />);
    await screen.findByText(/new-plan/);
    await act(async () => {
      resolve([plan("old-plan")]);
    });
    expect(screen.queryByText(/old-plan/)).not.toBeInTheDocument();
  });

  it("requires three separate internal-party confirmations and hides manager finalize before they exist", async () => {
    const internal = plan("internal-plan");
    internal.current.producerOrgId =
      internal.current.transporterOrgId =
      internal.current.retailerOrgId =
        "carrier";
    api.request.mockImplementation((path: string) =>
      Promise.resolve(path.endsWith("planning-lots") ? [] : [internal]),
    );
    render(<ShipmentPlansPanel {...props} manager />);
    await screen.findByText("Bàn giao nội bộ trong cùng doanh nghiệp.");
    for (const role of ["sản xuất", "vận chuyển", "bán lẻ"])
      expect(
        screen.getByRole("button", { name: `Xác nhận vai trò ${role}` }),
      ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Tạo chuyến theo kế hoạch đã xác nhận",
      }),
    ).not.toBeInTheDocument();
  });
  it("compares decimal quantities exactly and requires new consent when available stock changes", async () => {
    const confirmed = plan("confirmed-plan");
    confirmed.current.quantity = "5";
    confirmed.current.acceptances = (
      ["PRODUCER", "TRANSPORTER", "RETAILER"] as const
    ).map((party) => ({
      party,
      organizationId: "carrier",
      acceptedAt: "2026-10-12T00:00:00Z",
    }));
    let available = "5.000";
    api.request.mockImplementation((path: string) =>
      Promise.resolve(
        path.endsWith("planning-lots")
          ? [
              {
                id: "lot",
                lotCode: "LOT-1",
                productName: "Crop",
                producerOrgId: "producer",
                quantity: available,
                unit: "kg",
              },
            ]
          : [confirmed],
      ),
    );
    render(<ShipmentPlansPanel {...props} manager />);
    await screen.findByRole("button", {
      name: "Tạo chuyến theo kế hoạch đã xác nhận",
    });
    available = "4.000";
    fireEvent.click(screen.getByRole("button", { name: "Tải lại kế hoạch" }));
    await screen.findByText(
      "Lượng khả dụng đã thay đổi. Sửa kế hoạch và yêu cầu ba bên xác nhận lại.",
    );
    expect(
      screen.queryByRole("button", {
        name: "Tạo chuyến theo kế hoạch đã xác nhận",
      }),
    ).not.toBeInTheDocument();
  });
});
