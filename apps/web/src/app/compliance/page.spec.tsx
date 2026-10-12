import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompliancePage from "./page";
import type { AuthUser, LotTrace, ProductionCycleOption } from "@/lib/types";
import type { components } from "@/lib/generated/api";

const api = vi.hoisted(() => ({
  request: vi.fn(),
  getLots: vi.fn(),
  getProductionCycles: vi.fn(),
}));
vi.mock("@/lib/api-client", () => api);
let user: AuthUser;
vi.mock("@/lib/auth-store", () => ({ useAuth: () => ({ user }) }));
const cycle = {
  id: "cycle",
  cycleCode: "CY",
  chainId: "chain",
  canWriteProduction: false,
  canReviewCompliance: true,
} as ProductionCycleOption;
beforeEach(() => {
  vi.resetAllMocks();
  user = {
    id: "reviewer",
    email: "reviewer@example.test",
    fullName: "Reviewer",
    accountStatus: "ACTIVE",
    organizationId: "auditor",
    role: { code: "TRANSPORTER", name: "Transporter" },
  };
  api.getLots.mockResolvedValue([
    {
      lotId: "lot",
      lotCode: "LOT",
      productionCycle: { cycleId: "cycle" },
    } as LotTrace,
  ]);
  api.getProductionCycles.mockResolvedValue([cycle]);
  api.request.mockResolvedValue([]);
});
afterEach(() => cleanup());
describe("Compliance forms use current server subject permissions", () => {
  it("offers independent scoped inspection with another authenticated global role", async () => {
    render(<CompliancePage />);
    expect(
      await screen.findByText("Ghi kiểm định", { selector: "h2,h3" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Nộp chứng nhận", { selector: "h2,h3" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "LOT" })).toBeInTheDocument();
  });
  it("offers certificate submission for scoped production without global FARM_STAFF", async () => {
    api.getProductionCycles.mockResolvedValue([
      { ...cycle, canWriteProduction: true, canReviewCompliance: false },
    ]);
    render(<CompliancePage />);
    expect(
      await screen.findByText("Nộp chứng nhận", { selector: "h2,h3" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Ghi kiểm định", { selector: "h2,h3" }),
    ).not.toBeInTheDocument();
  });
  it("keeps a producer with an auditor capability from a scoped self-review form", async () => {
    user = { ...user, role: { code: "COMPLIANCE_REVIEWER", name: "Reviewer" } };
    api.getProductionCycles.mockResolvedValue([
      { ...cycle, canReviewCompliance: false },
    ]);
    render(<CompliancePage />);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Ghi kiểm định", { selector: "h2,h3" }),
    ).not.toBeInTheDocument();
  });
  it("does not offer review of a replacement when the reviewer submitted an ancestor", async () => {
    const root = {
      id: "original",
      status: "APPROVED",
      cycleId: "cycle",
      lotId: null,
      type: "Original",
      issuer: "Issuer",
      submittedByUserId: user.id,
      supersedesId: null,
    } as components["schemas"]["CertificateRecordDto"];
    const child = {
      ...root,
      id: "replacement",
      status: "PENDING",
      type: "Replacement",
      submittedByUserId: "different",
      supersedesId: root.id,
    };
    api.request.mockImplementation((path: string) =>
      Promise.resolve(path === "/certificates" ? [root, child] : []),
    );
    render(<CompliancePage />);
    await screen.findByText("Ghi kiểm định", { selector: "h2,h3" });
    expect(
      screen.queryByRole("option", { name: /Replacement/ }),
    ).not.toBeInTheDocument();
  });
});
