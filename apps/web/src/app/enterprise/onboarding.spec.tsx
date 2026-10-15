import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import RegisterPage from "../register/page";
import EnterprisePage from "./page";
import EnterpriseAdminPage from "../admin/enterprises/page";

vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({ useAuth: vi.fn() }));
const enrollment: Enrollment = {
  id: "enrollment",
  organizationId: "org",
  organizationName: "Công ty demo",
  organizationType: "FARM",
  representativeName: "Người đại diện",
  representativeEmail: "owner@example.test",
  businessId: "DEMO-12345",
  hostingMode: "MANAGED_ORG",
  status: "APPROVED",
  version: 1,
  reviewNote: null,
  connections: [],
};
let current: Enrollment;
const authenticate = (role = "FARM_STAFF") =>
  vi.mocked(useAuth).mockReturnValue({
    user: { id: "owner", organizationId: "org", role: { code: role } },
    isLoading: false,
  } as ReturnType<typeof useAuth>);
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  current = structuredClone(enrollment);
  authenticate();
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === "/enterprise-enrollments/mine") return current as never;
    if (path === "/enterprise-enrollments") return [current] as never;
    if (path === "/supply-chains")
      return [
        { id: "own-chain", name: "Chuỗi của tôi", ownerOrganizationId: "org" },
        {
          id: "foreign-chain",
          name: "Chuỗi khác",
          ownerOrganizationId: "other-org",
        },
      ] as never;
    return {} as never;
  });
});
afterEach(cleanup);

it("keeps the original registration and password only in memory after a lost response", async () => {
  vi.mocked(request)
    .mockRejectedValueOnce(new TypeError("Mất kết nối"))
    .mockResolvedValueOnce({});
  render(<RegisterPage />);
  for (const [name, value] of [
    ["Tên doanh nghiệp", "Doanh nghiệp demo"],
    ["Mã số doanh nghiệp / mã số thuế", "DEMO-12345"],
    ["Người đại diện", "Chủ doanh nghiệp"],
    ["Email", "owner@example.test"],
    ["Mật khẩu", "long-demo-password-2026"],
  ])
    fireEvent.change(screen.getByLabelText(new RegExp("^" + name)), {
      target: { value },
    });
  fireEvent.click(screen.getByLabelText(/Tự vận hành peer/));
  const submit = screen.getByRole("button", { name: "Gửi đăng ký" });
  fireEvent.submit(submit.closest("form")!);
  await screen.findByRole("button", { name: "Thử lại đăng ký ban đầu" });
  expect(screen.getByLabelText("Email")).toBeDisabled();
  fireEvent.submit(submit.closest("form")!);
  await screen.findByRole("heading", { name: "Đã tiếp nhận đăng ký" });
  const calls = vi.mocked(request).mock.calls;
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(JSON.parse(calls[0][1]?.body as string).hostingMode).toBe(
    "SELF_MANAGED_ORG",
  );
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it("allows corrected input after a definitive registration rejection", async () => {
  vi.mocked(request).mockRejectedValue(
    Object.assign(new Error("Email đã đăng ký"), { status: 409 }),
  );
  render(<RegisterPage />);
  fireEvent.submit(
    screen.getByRole("button", { name: "Gửi đăng ký" }).closest("form")!,
  );
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Email")).toBeEnabled();
});
it("shows pending approval without allowing a connection request", async () => {
  current.status = "PENDING_REVIEW";
  render(<EnterprisePage />);
  await screen.findByRole("status", { name: "" });
  await screen.findByText("Chờ xét duyệt");
  expect(
    screen.queryByRole("button", { name: "Gửi yêu cầu kết nối" }),
  ).toBeNull();
});
it("sends only the owned chain for managed hosting and keeps the original connection on retry", async () => {
  vi.mocked(request).mockImplementation(async (path) => {
    if (path === "/enterprise-connections") throw new TypeError("Mất phản hồi");
    if (path === "/enterprise-enrollments/mine") return current as never;
    return [
      { id: "own-chain", name: "Chuỗi của tôi", ownerOrganizationId: "org" },
      {
        id: "foreign-chain",
        name: "Chuỗi khác",
        ownerOrganizationId: "other-org",
      },
    ] as never;
  });
  render(<EnterprisePage />);
  const submit = await screen.findByRole("button", {
    name: "Gửi yêu cầu kết nối",
  });
  expect(screen.queryByRole("option", { name: "Chuỗi khác" })).toBeNull();
  expect(screen.queryByLabelText("Địa chỉ peer (IP hoặc DNS)")).toBeNull();
  fireEvent.submit(submit.closest("form")!);
  await screen.findByRole("button", { name: "Thử lại yêu cầu ban đầu" });
  fireEvent.submit(submit.closest("form")!);
  await waitFor(() =>
    expect(
      vi
        .mocked(request)
        .mock.calls.filter((c) => c[0] === "/enterprise-connections"),
    ).toHaveLength(2),
  );
  const writes = vi
    .mocked(request)
    .mock.calls.filter((c) => c[0] === "/enterprise-connections");
  expect(writes[0][1]).toEqual(writes[1][1]);
  expect(Object.keys(JSON.parse(writes[0][1]?.body as string)).sort()).toEqual([
    "chainId",
    "id",
  ]);
});
it("shows public peer fields for self-managed hosting and never requests a private key", async () => {
  current.hostingMode = "SELF_MANAGED_ORG";
  const { container } = render(<EnterprisePage />);
  await screen.findByLabelText("Chứng thư TLS CA công khai (PEM)");
  expect(screen.getByLabelText("MSP của doanh nghiệp")).toBeRequired();
  expect(container.querySelector('input[type="file"]')).toBeNull();
  expect(container.querySelector('input[name*="key" i]')).toBeNull();
});
it("limits administration to the system admin", async () => {
  render(<EnterpriseAdminPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent("không có quyền");
  expect(request).not.toHaveBeenCalled();
});
it("retries the same review decision after a lost response without offering a conflicting rejection", async () => {
  authenticate("SYSTEM_ADMIN");
  current.status = "PENDING_REVIEW";
  const normal = vi.mocked(request).getMockImplementation()!;
  vi.mocked(request).mockImplementation(async (path, options, auth) => {
    if (String(path).endsWith("/review")) throw new TypeError("Mất phản hồi");
    return normal(path, options, auth);
  });
  render(<EnterpriseAdminPage />);
  fireEvent.change(await screen.findByLabelText("Ghi chú xét duyệt"), {
    target: { value: "Đã xác minh" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Phê duyệt" }));
  const retry = await screen.findByRole("button", {
    name: "Thử lại quyết định ban đầu",
  });
  expect(screen.queryByRole("button", { name: "Từ chối" })).toBeNull();
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      vi
        .mocked(request)
        .mock.calls.filter((c) => String(c[0]).endsWith("/review")),
    ).toHaveLength(2),
  );
  const writes = vi
    .mocked(request)
    .mock.calls.filter((c) => String(c[0]).endsWith("/review"));
  expect(writes[0][1]).toEqual(writes[1][1]);
});
