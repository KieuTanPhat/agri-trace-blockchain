import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import EnterpriseAudit from "./enterprise-audit";
const mock = vi.hoisted(() => ({
  primary: true,
  query: vi.fn(),
  next: vi.fn(),
  refetch: vi.fn(),
  error: null as unknown,
  empty: false,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/ledger/workspace-context", () => ({
  useWorkspaceAccess: () => ({
    primary: mock.primary,
    can: () => mock.primary,
    isLoading: false,
  }),
}));
vi.mock("@/lib/ledger/data", () => ({
  useLedgerInfiniteQuery: (options: unknown) => {
    mock.query(options);
    return {
      data: {
        pages: [
          {
            items: mock.empty
              ? []
              : [
                  {
                    id: "activity:a",
                    occurredAt: "2026-11-05T08:00:00Z",
                    employee: {
                      id: "staff-a",
                      fullName: "Nhân viên thử",
                      email: "staff-a@example.test",
                    },
                    action: "RECORD_CARE",
                    category: "ACTIVITY",
                    outcome: "SUCCESS",
                  },
                ],
            nextCursor: "scoped-next",
          },
        ],
      },
      error: mock.error,
      isPending: false,
      isFetching: false,
      hasNextPage: !mock.empty,
      fetchNextPage: mock.next,
      refetch: mock.refetch,
    };
  },
}));
beforeEach(() => {
  vi.clearAllMocks();
  mock.primary = true;
  mock.error = null;
  mock.empty = false;
});
afterEach(cleanup);
it("shows the employee/action/time/result in the shared read-only table", () => {
  render(<EnterpriseAudit />);
  expect(screen.getByText("Nhân viên thử")).toBeInTheDocument();
  expect(screen.getByText("staff-a@example.test")).toBeInTheDocument();
  expect(screen.getByRole("cell", {name: "Ghi nhật ký chăm sóc"})).toBeInTheDocument();
  expect(screen.getByRole("cell", {name: "Thành công"})).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Xóa" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Xem thêm" }));
  expect(mock.next).toHaveBeenCalledOnce();
});
it("does not enable requests or show cached employee data for a non-owner", () => {
  mock.primary = false;
  render(<EnterpriseAudit />);
  expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
  expect(screen.queryByText("staff-a@example.test")).not.toBeInTheDocument();
  expect(mock.query.mock.calls.at(-1)?.[0].enabled).toBe(false);
});
it("applies name and date filters only after submission and can reset them", () => {
  render(<EnterpriseAudit />);
  fireEvent.change(screen.getByPlaceholderText("Tên hoặc email nhân viên"), {
    target: { value: "  Nhân viên  " },
  });
  expect(mock.query.mock.calls.at(-1)?.[0].queryKey[1]).toEqual({});
  fireEvent.change(screen.getByLabelText("Từ ngày"), {
    target: { value: "2026-11-05" },
  });
  fireEvent.change(screen.getByLabelText("Đến ngày"), {
    target: { value: "2026-11-01" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Ngày kết thúc");
  expect(mock.query.mock.calls.at(-1)?.[0].queryKey[1]).toEqual({});
  fireEvent.change(screen.getByLabelText("Đến ngày"), {
    target: { value: "2026-11-06" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Áp dụng" }));
  expect(mock.query.mock.calls.at(-1)?.[0].queryKey[1]).toEqual(
    expect.objectContaining({
      q: "Nhân viên",
      from: expect.any(String),
      to: expect.any(String),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Xóa lọc" }));
  expect(mock.query.mock.calls.at(-1)?.[0].queryKey[1]).toEqual({});
});
it("hides stale rows on API failure and explains an empty result", () => {
  mock.error = { status: 403, message: "Không có quyền truy cập" };
  const first = render(<EnterpriseAudit />);
  expect(screen.queryByText("staff-a@example.test")).not.toBeInTheDocument();
  first.unmount();
  mock.error = null;
  mock.empty = true;
  render(<EnterpriseAudit />);
  expect(screen.getByText("Chưa có hoạt động nhân viên")).toBeInTheDocument();
});
