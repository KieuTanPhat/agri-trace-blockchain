import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminPage from "./page";
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({ user: { role: { code: "SYSTEM_ADMIN" } } }),
}));
vi.mock("@/lib/api-client", () => ({
  request: vi.fn(async (path: string) => {
    if (path === "/organizations")
      return [
        { id: "active", name: "Active owner", type: "FARM", status: "ACTIVE" },
        {
          id: "inactive",
          name: "Inactive owner",
          type: "FARM",
          status: "INACTIVE",
        },
        {
          id: "retail",
          name: "Retail owner",
          type: "RETAILER",
          status: "ACTIVE",
        },
      ];
    if (path === "/catalog")
      return {
        products: [],
        plots: [],
        farms: [
          {
            id: "valid",
            name: "Valid farm",
            organizationId: "active",
            status: "ACTIVE",
          },
          {
            id: "invalid",
            name: "Inactive owner farm",
            organizationId: "inactive",
            status: "ACTIVE",
          },
          {
            id: "retail",
            name: "Retail farm",
            organizationId: "retail",
            status: "ACTIVE",
          },
          {
            id: "inactive",
            name: "Inactive farm",
            organizationId: "active",
            status: "INACTIVE",
          },
        ],
      };
    return [];
  }),
}));
describe("Admin catalog references", () => {
  it("only offers active farms with active FARM owners for plot creation", async () => {
    render(<AdminPage />);
    await screen.findByText("Active owner");
    fireEvent.click(screen.getByRole("button", { name: "Thửa đất" }));
    expect(
      screen.getByRole("option", { name: "Valid farm" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Inactive owner farm" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Retail farm" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Inactive farm" }),
    ).not.toBeInTheDocument();
  });
});
