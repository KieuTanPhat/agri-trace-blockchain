import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OperationsPage from "./page";
import { request } from "@/lib/api-client";

vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({ user: { id: "admin-1" } }),
}));

const summary = {
  generatedAt: "2026-10-18T01:00:00.000Z",
  filters: { chainId: null, organizationId: null },
  outbox: {
    scopedBy: ["chain", "organization"],
    counts: {
      PENDING: 2,
      PROCESSING: 1,
      RETRY: 3,
      COMPLETED: 40,
      DEAD_LETTER: 1,
    },
    oldestUnfinishedAgeSeconds: 7_200,
    overdue: 2,
  },
  holds: {
    scopedBy: ["chain", "organization"],
    open: 1,
    oldestOpenAgeSeconds: 600,
  },
  ledgerJobs: {
    scopedBy: ["chain", "organization"],
    counts: { PENDING: 0, PROCESSING: 1, COMPLETED: 5, FAILED: 2 },
    oldestUnfinishedAgeSeconds: 30,
  },
  bindingHealth: { scopedBy: ["chain"], total: 4, unhealthy: 1 },
  mail: {
    scopedBy: ["organization"],
    counts: { PENDING: 3, SENT: 9, CANCELLED: 0 },
    retrying: 2,
    oldestPendingAgeSeconds: 100,
    overdue: 1,
  },
  accounts: {
    scopedBy: ["organization"],
    activeSessions: 12,
    lockedAccounts: 1,
    disabledAccounts: 3,
  },
};
const outboxRow = {
  id: "o1",
  eventType: "HARVEST_RECORDED",
  status: "DEAD_LETTER",
  attemptCount: 5,
  nextAttemptAt: null,
  leased: false,
  lastError: "connect ECONNREFUSED",
  createdAt: "2026-10-17T20:00:00.000Z",
  ageSeconds: 18_000,
  organization: { id: "org-1", name: "HTX An Phú" },
  chainId: "c1",
  chainName: "Chuỗi rau",
};
const mailRow = {
  id: "m1",
  kind: "REGISTRATION_OTP",
  status: "PENDING",
  attempts: 3,
  nextAttemptAt: "2026-10-18T01:05:00.000Z",
  createdAt: "2026-10-18T00:00:00.000Z",
  sentAt: null,
  ageSeconds: 3_600,
  organization: null,
};

const credentials = {
  generatedAt: "2026-10-18T01:00:00.000Z",
  certificates: {
    scopedBy: ["chain"],
    expired: 1,
    within7Days: 1,
    within14Days: 0,
    within30Days: 2,
    unknownExpiry: 0,
    items: [
      {
        bindingDigest: "abcdef0123456789",
        chainId: "c1",
        certificateExpiresAt: "2026-10-16T00:00:00.000Z",
        daysLeft: -2,
        bucket: "EXPIRED",
        lastCheckedAt: "2026-10-18T00:55:00.000Z",
      },
    ],
  },
  credentials: { scopedBy: ["chain"], approved: 3, revoked: 0, items: [] },
  signingKeys: {
    scopedBy: ["chain", "organization"],
    expiryTracked: false,
    counts: { PENDING_LEDGER: 0, ACTIVE: 4, REVOKED: 1 },
    items: [],
  },
};

function respond(path: string) {
  if (path.startsWith("/platform-operations/credentials"))
    return Promise.resolve(credentials);
  if (path === "/supply-chains")
    return Promise.resolve([{ id: "c1", name: "Chuỗi rau" }]);
  if (path === "/organizations")
    return Promise.resolve([
      { id: "org-1", name: "HTX An Phú", type: "FARM" },
      { id: "aud", name: "Đơn vị kiểm định", type: "AUDITOR" },
    ]);
  if (path.startsWith("/platform-operations/summary"))
    return Promise.resolve(summary);
  if (path.startsWith("/platform-operations/outbox"))
    return Promise.resolve({ items: [outboxRow], nextCursor: null });
  if (path.startsWith("/platform-operations/mail"))
    return Promise.resolve({ items: [mailRow], nextCursor: null });
  return Promise.resolve({ items: [], nextCursor: null });
}

describe("Admin operations dashboard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(request).mockImplementation(((path: string) =>
      respond(path)) as never);
  });
  afterEach(cleanup);

  it("shows platform health, flags problem areas and never offers a write action", async () => {
    render(<OperationsPage />);
    await screen.findByText("Hàng đợi ghi sổ cái");
    // 2 + 1 + 3 unfinished, with dead-letter and overdue called out.
    const card = (await screen.findByText("Ghi sổ cái chưa xong")).closest(
      ".manage-metric",
    ) as HTMLElement;
    expect(card).toHaveTextContent("6");
    expect(card).toHaveTextContent("1 dead-letter");
    expect(card).toHaveTextContent("2 quá hạn");
    expect(card).toHaveTextContent("cũ nhất 2 giờ");
    expect(card.className).toContain("manage-metric--alert");
    expect(screen.getByText("Hold giao nhận đang mở")).toBeTruthy();
    expect(
      screen.getByText("Kết nối bất thường").closest(".manage-metric"),
    ).toHaveTextContent("Trên 4 kết nối");
    expect(await screen.findByText("HARVEST_RECORDED")).toBeTruthy();
    expect(
      within(screen.getByRole("table")).getByText("HTX An Phú"),
    ).toBeTruthy();
    // Read-only: no retry/delete/edit control, only filters and reload.
    expect(
      screen.queryByRole("button", { name: /thử lại|retry|xóa|sửa|bỏ qua/i }),
    ).toBeNull();
    const methods = vi
      .mocked(request)
      .mock.calls.map(
        ([, init]) => (init as RequestInit | undefined)?.method ?? "GET",
      );
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  it("sends chain and organization filters and says which cards cannot be filtered", async () => {
    render(<OperationsPage />);
    await screen.findByText("HARVEST_RECORDED");
    fireEvent.change(screen.getByLabelText("Lọc theo chuỗi"), {
      target: { value: "c1" },
    });
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        "/platform-operations/summary?chainId=c1",
      ),
    );
    // Mail and sessions cannot be scoped by chain: the UI says so.
    const mail = screen
      .getByText("Thư chờ gửi")
      .closest(".manage-metric") as HTMLElement;
    expect(mail).toHaveTextContent("Không lọc được theo bộ lọc này");
    const outbox = screen
      .getByText("Ghi sổ cái chưa xong")
      .closest(".manage-metric") as HTMLElement;
    expect(outbox).not.toHaveTextContent("Không lọc được theo bộ lọc này");
    // Auditor organizations are not offered as an enterprise filter.
    expect(
      screen.queryByRole("option", { name: "Đơn vị kiểm định" }),
    ).toBeNull();
  });

  it("warns about expired certificates and says signing keys have no expiry", async () => {
    render(<OperationsPage />);
    const card = (await screen.findByText("Chứng thư cần chú ý")).closest(
      ".manage-metric",
    ) as HTMLElement;
    expect(card).toHaveTextContent("2");
    expect(card).toHaveTextContent("1 đã hết hạn");
    expect(card.className).toContain("manage-metric--alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Chứng thư & khóa ký" }),
    );
    expect(await screen.findByText("Quá hạn 2 ngày")).toBeTruthy();
    expect(
      screen.getByText(/chưa có ngày hết hạn trong hệ thống/u),
    ).toBeTruthy();
    expect(screen.getByText(/4 đang dùng/u)).toBeTruthy();
  });

  it("lists the mail queue as metadata only", async () => {
    render(<OperationsPage />);
    await screen.findByText("HARVEST_RECORDED");
    fireEvent.click(screen.getByRole("button", { name: "Hàng đợi thư" }));
    await screen.findByText("REGISTRATION_OTP");
    expect(vi.mocked(request)).toHaveBeenCalledWith(
      "/platform-operations/mail",
    );
    expect(screen.queryByText(/@/u)).toBeNull();
  });
});
