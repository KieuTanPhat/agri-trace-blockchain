import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlatformUser } from "@/lib/ledger/platform-api";
import { PlatformUsers } from "./screen";
const mock = vi.hoisted(() => ({
  users: [] as unknown[],
  rolesError: null as unknown,
  refetch: vi.fn(),
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
vi.mock("@/lib/ledger/platform-access", () => ({
  useLedgerSession: () => ({ user: { id: "me" }, can: () => true }),
}));
vi.mock("@/lib/ledger/data", () => ({
  useLedgerQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data:
      queryKey[0] === "users"
        ? mock.users
        : queryKey[0] === "roles"
          ? [
              { code: "SYSTEM_ADMIN", name: "Quản trị" },
              { code: "AUDITOR", name: "Kiểm định" },
            ]
          : [],
    error: queryKey[0] === "roles" ? mock.rolesError : null,
    isLoading: false,
    refetch: mock.refetch,
  }),
  useLedgerQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
const admin: PlatformUser = {
  id: "admin-a",
  email: "admin@example.test",
  fullName: "Nguyễn Văn An",
  accountStatus: "ACTIVE",
  version: 2,
  lockedUntil: null,
  mustChangePassword: true,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-11-05T00:00:00Z",
  role: { code: "SYSTEM_ADMIN", name: "Quản trị nền tảng" },
  organization: null,
};
const staff: PlatformUser = {
  ...admin,
  id: "staff-a",
  email: "staff@example.test",
  fullName: "Trần Thị Bình",
  role: { code: "ENTERPRISE_STAFF", name: "Nhân viên doanh nghiệp" },
  organization: { id: "org-a", name: "HTX Rau sạch A", type: "FARM" },
};
beforeEach(() => {
  mock.users = [
    { ...admin, password: "DO-NOT-DISPLAY", passwordHash: "HASH-NOT-FOR-UI" },
    staff,
    {
      ...admin,
      id: "machine-a",
      fullName: "Máy cảm biến",
      role: { code: "IOT_DEVICE", name: "Thiết bị" },
    },
  ];
  mock.rolesError = null;
  mock.refetch.mockReset();
  mock.push.mockReset();
});
afterEach(() => cleanup());
it("lists human accounts without rendering password fields or unexpected secret properties", () => {
  render(<PlatformUsers />);
  expect(screen.getByText(admin.fullName)).toBeInTheDocument();
  expect(screen.getByText(staff.fullName)).toBeInTheDocument();
  expect(screen.queryByText("Máy cảm biến")).not.toBeInTheDocument();
  expect(screen.getByText("Hiển thị 2/2 tài khoản")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("DO-NOT-DISPLAY");
  expect(document.body.textContent).not.toContain("HASH-NOT-FOR-UI");
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
it("finds names without Vietnamese accents and clears an empty-result search", () => {
  render(<PlatformUsers />);
  fireEvent.change(screen.getByRole("textbox", { name: "Tên hoặc email" }), {
    target: { value: "nguyen van an" },
  });
  expect(screen.getByText(admin.fullName)).toBeInTheDocument();
  expect(screen.queryByText(staff.fullName)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "Tên hoặc email" }), {
    target: { value: "missing-account" },
  });
  expect(screen.getByText("Không có tài khoản phù hợp")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Xóa lọc" }));
  expect(screen.getByText(staff.fullName)).toBeInTheDocument();
});
it("shows scoped enterprise account details without offering unsupported password/status actions", () => {
  render(<PlatformUsers accountId={staff.id} />);
  expect(
    screen.getByRole("heading", { name: "Thông tin tài khoản" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: staff.organization!.name }),
  ).toHaveAttribute("href", "/admin/organizations?organizationId=org-a");
  expect(
    screen.queryByRole("button", { name: "Thao tác với " + staff.fullName }),
  ).not.toBeInTheDocument();
  expect(document.querySelector('input[type="password"]')).toBeNull();
});
it("keeps a newly entered temporary reset password masked, with no reveal control", async () => {
  render(<PlatformUsers accountId={admin.id} />);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Thao tác với " + admin.fullName }),
    { key: "Enter" },
  );
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Đặt mật khẩu tạm" }),
  );
  const dialog = await screen.findByRole("dialog");
  const input = within(dialog).getByLabelText("Mật khẩu tạm", { exact: true });
  fireEvent.change(input, { target: { value: "New-local-password-2026!" } });
  expect(input).toHaveAttribute("type", "password");
  expect(dialog.textContent).not.toContain("New-local-password-2026!");
  expect(
    within(dialog).queryByRole("button", {
      name: /hiện mật khẩu|xem mật khẩu/i,
    }),
  ).not.toBeInTheDocument();
});
it("hides mutations when supported-role lookup fails and permits retry", () => {
  mock.rolesError = { status: 503, message: "Roles unavailable" };
  render(<PlatformUsers accountId={admin.id} />);
  expect(
    screen.queryByRole("button", { name: "Thao tác với " + admin.fullName }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Tạo tài khoản" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});
it("creates accounts without asking for or displaying a password", async () => {
  render(<PlatformUsers createMode />);
  const dialog = await screen.findByRole("dialog");
  expect(
    within(dialog).getByLabelText("Email", { exact: true }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByLabelText("Họ tên", { exact: true }),
  ).toBeInTheDocument();
  expect(dialog.querySelector('input[type="password"]')).toBeNull();
  expect(
    within(dialog).queryByLabelText("Mật khẩu tạm", { exact: true }),
  ).not.toBeInTheDocument();
});
it("renders an explicit missing-account state instead of an empty filtered table", () => {
  render(<PlatformUsers accountId="missing" />);
  expect(screen.getByText("Không tìm thấy tài khoản")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
