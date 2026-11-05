import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Plan } from "@/lib/ledger/operations-types";
import { Plans } from "./screen";
const mock = vi.hoisted(() => ({
  plans: [] as Plan[],
  write: true,
  error: null as unknown,
  refetch: vi.fn(),
  createPlan: vi.fn(),
  setPlanStatus: vi.fn(),
  draftVersion: vi.fn(),
  publishVersion: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/ledger/platform-access", () => ({
  useLedgerSession: () => ({ can: () => mock.write }),
}));
vi.mock("@/lib/ledger/data", () => ({
  useLedgerQuery: () => ({
    data: mock.error ? undefined : mock.plans,
    error: mock.error,
    refetch: mock.refetch,
  }),
  useLedgerQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/lib/ledger/operations-api", () => ({
  api: {
    billing: {
      plans: vi.fn(),
      createPlan: mock.createPlan,
      setPlanStatus: mock.setPlanStatus,
      draftVersion: mock.draftVersion,
      publishVersion: mock.publishVersion,
    },
  },
}));
function plan(
  code: string,
  name: string,
  status = "ACTIVE",
  versionStatus = "PUBLISHED",
): Plan {
  return {
    code,
    name,
    status,
    description: "Gói thử",
    audience: "",
    versions: [
      {
        id: code + "-v1",
        planCode: code,
        version: 1,
        status: versionStatus,
        setupFee: 0,
        annualFee: 1000,
        termMonths: 12,
        limits: { products: 5, chains: 1, partners: 10, members: 10 },
        note: null,
        activeSubscriptions: 3,
        createdAt: "2026-11-01T00:00:00Z",
        publishedAt:
          versionStatus === "PUBLISHED" ? "2026-11-01T00:00:00Z" : null,
      },
    ],
  };
}
beforeEach(() => {
  mock.plans = [
    plan("TEST_ACTIVE", "Gói Khởi đầu"),
    plan("TEST_STOPPED", "Gói đã dừng", "RETIRED"),
    plan("TEST_DRAFT", "Gói chờ công bố", "ACTIVE", "DRAFT"),
  ];
  mock.write = true;
  mock.error = null;
  vi.clearAllMocks();
  mock.createPlan.mockResolvedValue({ record: { code: "TEST_NEW" } });
  mock.setPlanStatus.mockResolvedValue({ record: { status: "RETIRED" } });
});
afterEach(cleanup);
it("uses one shared table with one row per plan and retains its publication history separately", async () => {
  render(<Plans />);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(4);
  fireEvent.click(
    screen.getByRole("button", { name: "Chi tiết gói Gói Khởi đầu" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText("Lịch sử phiên bản")).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "Tạo phiên bản nháp" }),
  ).toBeEnabled();
});
it("searches unaccented names/codes and resets filters", () => {
  render(<Plans />);
  fireEvent.change(screen.getByRole("textbox", { name: "Tên hoặc mã gói" }), {
    target: { value: "khoi dau" },
  });
  expect(screen.getByText("Gói Khởi đầu")).toBeInTheDocument();
  expect(screen.queryByText("Gói đã dừng")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Xóa lọc" }));
  expect(screen.getByText("Gói đã dừng")).toBeInTheDocument();
});
it("requires confirmation and a reason before stopping a service", async () => {
  render(<Plans />);
  fireEvent.click(screen.getAllByRole("button", { name: "Ngừng cung cấp" })[0]);
  const dialog = await screen.findByRole("dialog");
  expect(mock.setPlanStatus).not.toHaveBeenCalled();
  fireEvent.change(
    within(dialog).getByLabelText("Lý do thay đổi", { exact: true }),
    { target: { value: "Tạm dừng gói để cập nhật bảng giá" } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Xác nhận ngừng cung cấp" }),
  );
  await waitFor(() => expect(mock.setPlanStatus).toHaveBeenCalledOnce());
  expect(mock.setPlanStatus.mock.calls[0][0]).toBe("TEST_ACTIVE");
  expect(mock.setPlanStatus.mock.calls[0][1]).toMatchObject({
    status: "RETIRED",
    expectedStatus: "ACTIVE",
  });
});
it("adds a new plan as a draft and validates the required identity fields", async () => {
  render(<Plans />);
  fireEvent.click(screen.getByRole("button", { name: "Thêm gói dịch vụ" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Mã gói", { exact: true }), {
    target: { value: "TEST_NEW" },
  });
  fireEvent.change(
    within(dialog).getByLabelText("Tên gói dịch vụ", { exact: true }),
    { target: { value: "Gói kiểm thử mới" } },
  );
  fireEvent.change(
    within(dialog).getByLabelText("Phí năm (VND)", { exact: true }),
    { target: { value: "1000" } },
  );
  fireEvent.change(
    within(dialog).getByLabelText("Ghi chú thay đổi", { exact: true }),
    { target: { value: "Tạo gói mới để kiểm tra bảng giá" } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Thêm gói và lưu bản nháp" }),
  );
  await waitFor(() => expect(mock.createPlan).toHaveBeenCalledOnce());
  expect(mock.createPlan.mock.calls[0][0]).toMatchObject({
    code: "TEST_NEW",
    annualFee: 1000,
    limits: { products: 5, chains: 1 },
  });
  expect(mock.publishVersion).not.toHaveBeenCalled();
});
it("hides add/stop/resume/draft controls for the read-only role", async () => {
  mock.write = false;
  render(<Plans />);
  expect(
    screen.queryByRole("button", { name: "Thêm gói dịch vụ" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Mở lại" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Ngừng cung cấp" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Chi tiết gói Gói chờ công bố" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).queryByRole("button", { name: "Công bố" }),
  ).not.toBeInTheDocument();
});
it("handles loading failure with retry instead of an empty table", () => {
  mock.error = { status: 503, message: "Không tải được gói" };
  render(<Plans />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
