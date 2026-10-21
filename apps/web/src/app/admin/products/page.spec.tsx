import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminProductsPage from "./page";
import AdminOrganizationProductsPage from "./[organizationId]/page";

const farmA = "16e83e47-205d-4c9a-8ece-4e741b90ed32";
const farmB = "26e83e47-205d-4c9a-8ece-4e741b90ed33";
const emptyOrg = "36e83e47-205d-4c9a-8ece-4e741b90ed34";
const route = vi.hoisted(() => ({ id: "" }));
const data = vi.hoisted(() => ({
  catalog: {},
  organizations: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ organizationId: route.id }),
  usePathname: () => "/admin/products",
}));
vi.mock("@/lib/workspace", () => ({
  useWorkspaceData: (path: string) => ({
    data: path === "/catalog" ? data.catalog : data.organizations,
    loading: false,
    error: "",
    reload: vi.fn(),
  }),
}));

function product(id: string, name: string, organizationId: string | null) {
  return {
    id,
    productName: name,
    organizationId,
    sku: null,
    gtin: null,
    variety: null,
    defaultUnit: "kg",
    description: null,
    status: "ACTIVE",
    createdAt: "2026-10-17T00:00:00.000Z",
    updatedAt: "2026-10-17T00:00:00.000Z",
  };
}

beforeEach(() => {
  data.organizations = [
    { id: farmA, name: "Nông trại An Phú", type: "FARM" },
    { id: farmB, name: "Hợp tác xã Bình Minh", type: "FARM" },
    { id: emptyOrg, name: "Vận tải Chưa Có", type: "TRANSPORTER" },
    { id: "auditor", name: "Đơn vị kiểm định", type: "AUDITOR" },
  ];
  data.catalog = {
    products: [
      product("p1", "Cải ngọt VietGAP", farmA),
      product("p2", "Cà chua bi", farmA),
      product("p3", "Xoài cát", farmB),
      product("p4", "Rau cải xanh", null),
    ],
  };
});
afterEach(cleanup);

describe("Admin product overview", () => {
  it("lists every enterprise with its product count, without auditors", () => {
    render(<AdminProductsPage />);
    const table = within(screen.getByRole("table"));
    const row = (name: string) =>
      table.getByText(name).closest("tr") as HTMLElement;
    const count = (name: string) =>
      row(name).querySelector('[data-label="Sản phẩm"]')?.textContent;
    expect(count("Nông trại An Phú")).toBe("2");
    expect(count("Hợp tác xã Bình Minh")).toBe("1");
    expect(count("Vận tải Chưa Có")).toBe("Chưa có");
    expect(screen.queryByText("Đơn vị kiểm định")).toBeNull();
    expect(
      within(row("Danh mục dùng chung")).getByRole("link").getAttribute("href"),
    ).toBe("/admin/products/shared");
    expect(
      within(row("Nông trại An Phú")).getByRole("link").getAttribute("href"),
    ).toBe(`/admin/products/${farmA}`);
  });

  it("finds the owning enterprise from a product name", () => {
    render(<AdminProductsPage />);
    fireEvent.change(screen.getByLabelText("Tìm doanh nghiệp hoặc sản phẩm"), {
      target: { value: "xoài" },
    });
    expect(screen.getByText("Hợp tác xã Bình Minh")).toBeTruthy();
    expect(screen.getByText(/Khớp: Xoài cát/)).toBeTruthy();
    expect(screen.queryByText("Nông trại An Phú")).toBeNull();
  });

  it("filters enterprises that have not created products", () => {
    render(<AdminProductsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Chưa có sản phẩm" }));
    expect(screen.getByText("Vận tải Chưa Có")).toBeTruthy();
    expect(screen.queryByText("Nông trại An Phú")).toBeNull();
    expect(
      within(screen.getByRole("table")).queryByText("Danh mục dùng chung"),
    ).toBeNull();
  });
});

describe("Admin enterprise product list", () => {
  it("shows only the selected enterprise's products", () => {
    route.id = farmA;
    render(<AdminOrganizationProductsPage />);
    expect(
      screen.getByRole("heading", { name: "Nông trại An Phú" }),
    ).toBeTruthy();
    expect(screen.getByText("Cải ngọt VietGAP")).toBeTruthy();
    expect(screen.getByText("Cà chua bi")).toBeTruthy();
    expect(screen.queryByText("Xoài cát")).toBeNull();
    expect(screen.queryByText("Rau cải xanh")).toBeNull();
    expect(screen.getByText("2 / 2 sản phẩm · Chỉ xem")).toBeTruthy();
  });

  it("shows the shared catalog and an explained empty state", () => {
    route.id = "shared";
    render(<AdminOrganizationProductsPage />);
    expect(screen.getByText("Rau cải xanh")).toBeTruthy();
    cleanup();
    route.id = emptyOrg;
    render(<AdminOrganizationProductsPage />);
    expect(screen.getByText("Chưa có sản phẩm")).toBeTruthy();
  });

  it("reports an unknown enterprise instead of an empty list", () => {
    route.id = "36e83e47-205d-4c9a-8ece-4e741b90ffff";
    render(<AdminOrganizationProductsPage />);
    expect(screen.getByText("Không tìm thấy doanh nghiệp")).toBeTruthy();
  });
});
