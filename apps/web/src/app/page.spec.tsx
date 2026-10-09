import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import DashboardPage from "./page";
import { getDashboard } from "@/lib/api-client";
import { mockDashboard } from "@/lib/mock-api";
import type { Role } from "@/lib/types";

const { auth } = vi.hoisted(() => ({
  auth: {
    user: {
      id: "user",
      organizationId: "farm",
      role: { code: "FARM_STAFF" as Role },
    },
  },
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api-client", () => ({ getDashboard: vi.fn() }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/components/action-panel", () => ({ ActionPanel: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

it.each([
  "SYSTEM_ADMIN",
  "AUDITOR",
  "TRANSPORTER",
  "RETAILER",
  "FARM_STAFF",
] as Role[])(
  "shows both simulator links only when %s can open that route",
  async (role) => {
    auth.user.role.code = role;
    vi.mocked(getDashboard).mockResolvedValue(await mockDashboard());
    render(<DashboardPage />);
  await screen.findByRole("heading", { name: "Tổng quan" });
    const links = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("href") === "/iot-simulator");
    expect(links).toHaveLength(role === "FARM_STAFF" ? 2 : 0);
  },
);
