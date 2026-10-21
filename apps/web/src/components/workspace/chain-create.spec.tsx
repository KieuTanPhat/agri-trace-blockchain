import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { ChainCreate } from "./chain-create";

const push = vi.fn();
vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    user: { id: "owner", organizationId: "own-org", role: { code: "FARM_STAFF" } },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

beforeEach(() => {
  vi.mocked(request).mockImplementation(async (path, init) => {
    if (path === "/enterprise-workspace")
      return {
        organization: { id: "own-org", name: "HTX Rau sạch", capabilities: ["FARM"] },
        member: { primary: true },
        permissions: [],
      } as never;
    if (path === "/enterprise-workspace/partners")
      return {
        items: [
          {
            id: "p1",
            status: "ACTIVE",
            inviterId: "own-org",
            inviteeId: "retail-org",
            invitee: { id: "retail-org", name: "Cửa hàng An Tâm", type: "RETAILER" },
          },
        ],
      } as never;
    if (path === "/catalog") return { products: [] } as never;
    if (path === "/supply-chains" && init?.method === "POST")
      return { id: "chain-1" } as never;
    return {} as never;
  });
});
afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
  push.mockReset();
});

it("requires a supply model and sends the chosen participants after confirmation", async () => {
  render(<ChainCreate />);
  await screen.findByText("Cửa hàng An Tâm");
  fireEvent.change(screen.getByLabelText(/^Tên chuỗi/), {
    target: { value: "Chuỗi rau sạch" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Tạo chuỗi truy xuất" }));
  expect(await screen.findByText(/Chọn ít nhất một khâu/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox", { name: "HTX Rau sạch — Sản xuất" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Cửa hàng An Tâm — Bán lẻ" }));
  fireEvent.change(screen.getByLabelText(/^Loại chuỗi/), {
    target: { value: "LIVESTOCK" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Tạo chuỗi truy xuất" }));
  await screen.findByRole("heading", { name: "Xác nhận tạo chuỗi truy xuất" });
  expect(
    vi.mocked(request).mock.calls.some(
      ([path, init]) => path === "/supply-chains" && init?.method === "POST",
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận tạo" }));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/supply-chains/chain-1"));
  const body = JSON.parse(
    String(
      vi
        .mocked(request)
        .mock.calls.find(
          ([path, init]) => path === "/supply-chains" && init?.method === "POST",
        )![1]!.body,
    ),
  );
  expect(body.chainType).toBe("LIVESTOCK");
  expect(body.participants).toEqual([
    { organizationId: "own-org", stage: "FARM" },
    { organizationId: "retail-org", stage: "RETAILER" },
  ]);
});
