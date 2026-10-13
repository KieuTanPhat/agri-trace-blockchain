import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LedgerStatusPanel } from "./ledger-status-panel";
import type { components } from "@/lib/generated/api";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api-client", () => api);

const base: components["schemas"]["LedgerStatusDto"] = {
  chainId: "chain-one",
  profile: "MANAGED_ORG",
  bindingStatus: "ACTIVE",
  channelId: "hybrid-b",
  permissions: { active: 4, pending: 0, revoking: 0, held: 0 },
  delivery: {
    completed: 7,
    pending: 0,
    retry: 0,
    deadLetter: 0,
    oldestPendingAt: null,
    pendingAgeSeconds: null,
  },
  openHolds: 0,
  pendingControlJobs: 0,
  failedControlJobs: 0,
  lastControlFailureAt: null,
  worker: {
    lastCheckedAt: "2026-10-13T00:00:00Z",
    lastHealthyAt: "2026-10-13T00:00:00Z",
    lastErrorCode: null,
    certificateExpiresAt: "2099-01-01T00:00:00Z",
    heartbeatStale: false,
    certificateExpired: false,
    healthy: true,
  },
};

afterEach(() => {
  cleanup();
  api.request.mockReset();
});

describe("LedgerStatusPanel", () => {
  it("reports a healthy managed binding without any alert", async () => {
    api.request.mockResolvedValue(base);
    render(<LedgerStatusPanel chainId="chain-one" />);
    expect(await screen.findByText(/Tổ chức riêng trên Fabric/)).toBeTruthy();
    expect(screen.getByText(/kênh hybrid-b/)).toBeTruthy();
    expect(screen.getByText(/Sự kiện đã xác nhận: 7/)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.request).toHaveBeenCalledWith(
      "/supply-chains/chain-one/ledger-status",
    );
  });

  it("shows backlog and flags holds and dead letters as needing review", async () => {
    api.request.mockResolvedValue({
      ...base,
      permissions: { active: 3, pending: 1, revoking: 0, held: 1 },
      delivery: {
        completed: 2,
        pending: 2,
        retry: 1,
        deadLetter: 1,
        oldestPendingAt: "2026-10-13T00:00:00Z",
      },
      openHolds: 1,
    });
    render(<LedgerStatusPanel chainId="chain-one" />);
    expect(await screen.findByText(/Sự kiện đang chờ gửi: 3/)).toBeTruthy();
    expect(screen.getByText(/Quyền chờ xác nhận: 1/)).toBeTruthy();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /1 lệnh giữ.*1 quyền bị giữ.*1 sự kiện lỗi vĩnh viễn/,
    );
  });

  it("surfaces a silent worker, an expired certificate, failed jobs and a slow backlog", async () => {
    api.request.mockResolvedValue({
      ...base,
      failedControlJobs: 2,
      lastControlFailureAt: "2026-10-13T01:00:00Z",
      delivery: { ...base.delivery, pending: 3, pendingAgeSeconds: 1200 },
      worker: {
        ...base.worker,
        lastHealthyAt: null,
        heartbeatStale: true,
        certificateExpired: true,
        lastErrorCode: "ENDORSEMENT",
        healthy: false,
      },
    });
    render(<LedgerStatusPanel chainId="chain-one" />);
    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toMatch(/chưa báo hoạt động/);
    expect(alert).toMatch(/Chứng thư.*hết hạn/);
    expect(alert).toMatch(/ENDORSEMENT/);
    expect(alert).toMatch(/2 tác vụ điều khiển ledger đã thất bại/);
    expect(alert).toMatch(/20 phút/);
  });

  it("does not alarm for a short backlog with a live worker", async () => {
    api.request.mockResolvedValue({
      ...base,
      delivery: { ...base.delivery, pending: 1, pendingAgeSeconds: 30 },
    });
    render(<LedgerStatusPanel chainId="chain-one" />);
    await screen.findByText(/Sự kiện đang chờ gửi: 1/);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("describes a chain that still uses the release-A route and hides ledger counters", async () => {
    api.request.mockResolvedValue({
      ...base,
      profile: "RELEASE_A",
      bindingStatus: null,
      channelId: null,
    });
    render(<LedgerStatusPanel chainId="chain-one" />);
    expect(await screen.findByText(/Chưa dùng Fabric theo chuỗi/)).toBeTruthy();
    expect(screen.queryByText(/Quyền đã xác nhận/)).toBeNull();
  });

  it("drops the previous chain's data when the chain changes", async () => {
    let resolveFirst: (value: unknown) => void = () => undefined;
    api.request
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = resolve)),
      )
      .mockResolvedValueOnce({
        ...base,
        chainId: "chain-two",
        channelId: "hybrid-self",
      });
    const { rerender } = render(<LedgerStatusPanel chainId="chain-one" />);
    rerender(<LedgerStatusPanel chainId="chain-two" />);
    await screen.findByText(/kênh hybrid-self/);
    resolveFirst(base);
    await waitFor(() => expect(screen.queryByText(/kênh hybrid-b/)).toBeNull());
  });

  it("surfaces an authorization failure instead of stale data", async () => {
    api.request.mockRejectedValue(new Error("Không tìm thấy chuỗi"));
    render(<LedgerStatusPanel chainId="chain-one" />);
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Không tìm thấy chuỗi",
    );
  });
});
