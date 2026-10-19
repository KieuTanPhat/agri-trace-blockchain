import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaseRequests } from "./case-requests";
import { request } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({
  request: vi.fn(),
  retryPendingCommand: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({ user: { id: "u1", organizationId: "org-1" } }),
}));

const base = {
  caseNumber: 12,
  title: "Khiếu nại chất lượng rau",
  description: "Người tiêu dùng báo rau có mùi lạ",
  category: "QUALITY",
  severity: "HIGH",
  lot: { id: "l1", lotCode: "LOT-001" },
  responseDueAt: "2026-10-20T00:00:00.000Z",
  overdue: false,
  version: 3,
  createdAt: "2026-10-18T00:00:00.000Z",
  events: [
    {
      id: "e1",
      action: "ASSIGNED",
      note: "Nền tảng giao hồ sơ cho doanh nghiệp",
      createdAt: "2026-10-18T00:00:00.000Z",
    },
  ],
};

describe("Platform case requests on the enterprise notices page", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);

  it("lists what the platform addressed to the organization and offers acknowledge and respond", async () => {
    vi.mocked(request).mockResolvedValue([
      { ...base, id: "c1", status: "ASSIGNED" },
      { ...base, id: "c2", status: "CLOSED", title: "Hồ sơ cũ đã đóng" },
    ] as never);
    render(<CaseRequests />);
    expect(
      await screen.findByText(/#12 · Khiếu nại chất lượng rau/u),
    ).toBeTruthy();
    expect(screen.getByText("Yêu cầu từ nền tảng (1 đang mở)")).toBeTruthy();
    expect(screen.getAllByText(/lô LOT-001/u).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Xác nhận đã nhận" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Gửi phản hồi" })).toBeTruthy();
    // A closed case is history only: no action offered.
    expect(
      screen.getAllByRole("button", { name: "Gửi phản hồi" }),
    ).toHaveLength(1);
    // Answering is a message; it never offers a recall control here.
    expect(screen.queryByRole("button", { name: /thu hồi/iu })).toBeNull();
  });

  it("renders nothing when there are no cases or the member lacks access", async () => {
    vi.mocked(request).mockResolvedValue([] as never);
    const { container, rerender } = render(<CaseRequests />);
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    vi.mocked(request).mockRejectedValue({
      message: "Bạn chưa được cấp quyền",
    });
    rerender(<CaseRequests />);
    expect(container.textContent).toBe("");
  });
});
