import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CompliancePage from "@/features/ledger/workspace/compliance";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()})}));
vi.mock("@/lib/ledger/data",async()=>({useLedgerQuery:(await import("@tanstack/react-query")).useQuery,useLedgerQueryClient:(await import("@tanstack/react-query")).useQueryClient}));
vi.mock("@/lib/ledger/ops-api",()=>({opsApi:{cycles:()=>api.getProductionCycles(),certificates:()=>api.request("/certificates"),inspections:()=>api.request("/inspections")}}));
function renderPage(){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><CompliancePage/></QueryClientProvider>);}
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
  HTMLElement.prototype.scrollIntoView=vi.fn();
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
    renderPage();
    expect(
      await screen.findByRole("button", {name:"Ghi kiểm định"}),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {name:"Nộp chứng nhận"}),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"Ghi kiểm định"}));
    fireEvent.keyDown(screen.getByRole("combobox",{name:"Lô hàng"}),{key:"ArrowDown"});
    expect(await screen.findByRole("option", { name: "LOT" })).toBeInTheDocument();
  });
  it("offers certificate submission for scoped production without global FARM_STAFF", async () => {
    api.getProductionCycles.mockResolvedValue([
      { ...cycle, canWriteProduction: true, canReviewCompliance: false },
    ]);
    renderPage();
    expect(
      await screen.findByRole("button", {name:"Nộp chứng nhận"}),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", {name:"Ghi kiểm định"}),
    ).not.toBeInTheDocument();
  });
  it("keeps a producer with an auditor capability from a scoped self-review form", async () => {
    user = { ...user, role: { code: "COMPLIANCE_REVIEWER", name: "Reviewer" } };
    api.getProductionCycles.mockResolvedValue([
      { ...cycle, canReviewCompliance: false },
    ]);
    renderPage();
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", {name:"Ghi kiểm định"}),
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
    renderPage();
    await screen.findByRole("button", {name:"Ghi kiểm định"});
    expect(
      screen.queryByRole("button", {name:"Xét duyệt"}),
    ).not.toBeInTheDocument();
  });
});
