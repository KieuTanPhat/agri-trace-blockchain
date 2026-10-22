import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { InboxWorkspace } from "./inbox-workspace";

const { auth, confirm } = vi.hoisted(() => ({
  auth: { user: { id: "member-1", organizationId: "org-1" } },
  confirm: vi.fn(),
}));
vi.mock("@/lib/auth-store", () => ({ useAuth: () => auth }));
vi.mock("@/lib/api-client", () => ({
  request: vi.fn(),
  retryPendingCommand: vi.fn(),
}));
vi.mock("@/lib/ledger/confirmation", () => ({
  useConfirm: () => confirm,
  importantAction: () => null,
}));

const record = {
  id: "case-1",
  caseNumber: 12,
  title: "Đối soát cà chua",
  description: "Đối chiếu thông tin nhãn và biên bản giao nhận.",
  status: "ASSIGNED",
  category: "LABELING",
  severity: "HIGH",
  overdue: true,
  version: 7,
  lot: { id: "lot-1", lotCode: "LOT-001" },
  createdAt: "2026-10-18T00:00:00Z",
  responseDueAt: "2026-10-20T00:00:00Z",
  allowedActions: ["ACKNOWLEDGE", "RESPOND"],
  events: [
    {
      id: "event-1",
      action: "ASSIGNED",
      note: "Ghi chú được chia sẻ với doanh nghiệp.",
      createdAt: "2026-10-19T00:00:00Z",
    },
  ],
};
let permissions: string[];
let writes: (path: string, options: RequestInit) => Promise<unknown>;
beforeEach(() => {
  vi.resetAllMocks();
  permissions = [
    "profile.read",
    "cases.read",
    "cases.respond",
    "distribution.read",
    "reports.read",
  ];
  confirm.mockResolvedValue(true);
  writes = async () => ({});
  vi.mocked(request).mockImplementation(async (path, options) => {
    if (options?.method === "POST")
      return writes(String(path), options) as never;
    if (path === "/enterprise-workspace")
      return { member: { id: "member-1" }, permissions } as never;
    if (path === "/distribution/tasks")
      return {
        transfers: [
          {
            transferId: "transfer-1",
            action: "CONSENT",
            status: "PROPOSED",
            origin: "Kho nguồn",
            destination: "Kho nhận",
            role: "SENDER",
          },
        ],
        stock: [
          {
            lotId: "lot-1",
            lotCode: "LOT-001",
            productName: "Cà chua",
            kind: "EXPIRING",
            held: "25.000",
            quarantined: "0.000",
            unit: "kg",
          },
        ],
        counts: {},
      } as never;
    if (path === "/enterprise-workspace/ownership-transfers")
      return {
        items: [
          {
            id: "own-1",
            status: "PENDING",
            to: { id: "member-1", fullName: "Người nhận demo" },
            from: { fullName: "Chủ quản demo" },
            reason: "Bàn giao quản trị doanh nghiệp",
          },
          { id: "other-recipient", status: "PENDING", to: { id: "member-2" } },
        ],
      } as never;
    if (path === "/enterprise-cases")
      return [
        {
          ...record,
          allowedActions: permissions.includes("cases.respond")
            ? record.allowedActions
            : [],
        },
        {
          ...record,
          id: "closed-1",
          title: "Hồ sơ đã kết thúc",
          status: "CLOSED",
          caseNumber: 11,
          allowedActions: [],
        },
      ] as never;
    throw new Error(`Unexpected test request: ${path}`);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Enterprise work inbox", () => {
  it("opens scoped details and shared history, then filters without losing the reply draft", async () => {
    render(<InboxWorkspace />);
    const card = await screen.findByRole("article", { name: record.title });
    const note = within(card).getByRole("textbox");
    fireEvent.change(note, { target: { value: "Nội dung đang soạn" } });
    fireEvent.click(within(card).getByRole("button", { name: "Xem chi tiết" }));
    const dialog = screen.getByRole("dialog", { name: record.title });
    expect(within(dialog).getByText(record.events[0].note)).toBeVisible();
    expect(
      within(dialog).getByRole("link", { name: "Mở hồ sơ lô" }),
    ).toHaveAttribute("href", "/lots/lot-1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "doi soat ca chua" },
    });
    expect(screen.getByText("1 công việc")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "không tìm thấy" },
    });
    expect(card).not.toBeVisible();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    expect(note).toHaveValue("Nội dung đang soạn");
    fireEvent.click(screen.getByRole("button", { name: /Đã đóng/ }));
    const closed = screen.getByRole("article", { name: "Hồ sơ đã kết thúc" });
    expect(
      within(closed).queryByRole("button", { name: "Gửi phản hồi" }),
    ).toBeNull();
    expect(screen.getByText("1 công việc")).toBeVisible();
  });

  it("validates the response and sends the current case version only through the permitted action", async () => {
    render(<InboxWorkspace />);
    const card = await screen.findByRole("article", { name: record.title });
    fireEvent.click(within(card).getByRole("button", { name: "Gửi phản hồi" }));
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "ít nhất 10 ký tự",
    );
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "  Đã kiểm tra đầy đủ biên bản.  " },
    });
    fireEvent.click(within(card).getByRole("button", { name: "Gửi phản hồi" }));
    await screen.findByText("Đã gửi phản hồi cho hồ sơ #12.");
    const sent = vi
      .mocked(request)
      .mock.calls.find(([path]) => path === "/enterprise-cases/case-1/respond");
    expect(JSON.parse(String(sent?.[1]?.body))).toEqual({
      version: 7,
      note: "Đã kiểm tra đầy đủ biên bản.",
    });
  });

  it("does not fetch platform cases or expose their response controls without cases.read", async () => {
    permissions = ["profile.read", "distribution.read", "reports.read"];
    render(<InboxWorkspace />);
    await screen.findByText("3 công việc");
    expect(
      vi
        .mocked(request)
        .mock.calls.some(([path]) => path === "/enterprise-cases"),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: "Gửi phản hồi" })).toBeNull();
  });

  it("keeps shared case details readable without offering inaccessible lot or write controls", async () => {
    permissions = ["profile.read", "cases.read"];
    render(<InboxWorkspace />);
    const card = await screen.findByRole("article", { name: record.title });
    expect(
      within(card).queryByRole("button", { name: "Gửi phản hồi" }),
    ).toBeNull();
    expect(
      within(card).queryByRole("button", { name: "Xác nhận đã nhận" }),
    ).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "Xem chi tiết" }));
    const dialog = screen.getByRole("dialog", { name: record.title });
    expect(within(dialog).getByText(record.description)).toBeVisible();
    expect(
      within(dialog).queryByRole("link", { name: "Mở hồ sơ lô" }),
    ).toBeNull();
  });

  it("retains the uncertain command across filters and retries its original body and key", async () => {
    let attempts = 0;
    writes = async () => {
      if (++attempts <= 4) throw { status: 503, message: "Chưa rõ kết quả" };
      return {};
    };
    render(<InboxWorkspace />);
    const card = await screen.findByRole("article", { name: record.title });
    vi.useFakeTimers();
    fireEvent.change(within(card).getByRole("textbox"), {
      target: { value: "Phản hồi cần được đối soát" },
    });
    await act(async () => {
      fireEvent.click(
        within(card).getByRole("button", { name: "Gửi phản hồi" }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(within(card).getByRole("textbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Tải lại" })).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "không có" },
    });
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(
        within(card).getByRole("button", { name: "Thử lại yêu cầu cũ" }),
      );
    });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText("Đã gửi phản hồi cho hồ sơ #12.")).toBeVisible(),
    );
    const commands = vi
      .mocked(request)
      .mock.calls.filter(([, options]) => options?.method === "POST");
    expect(commands).toHaveLength(5);
    expect(new Set(commands.map(([, options]) => options?.body)).size).toBe(1);
    expect(
      new Set(
        commands.map(
          ([, options]) =>
            (options?.headers as Record<string, string>)["idempotency-key"],
        ),
      ).size,
    ).toBe(1);
    expect(confirm).toHaveBeenCalledTimes(1);
  });
});
