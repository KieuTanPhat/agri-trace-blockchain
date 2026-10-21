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
import EnterprisePage from "./connections/page";
import PlatformEnrollment from "@/components/workspace/platform-enrollment";
const EnterpriseAdminPage = () => <PlatformEnrollment id="enrollment" />;

vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/auth-store", () => ({ useAuth: vi.fn() }));
const enrollment: Enrollment = {
  participationModel: "SINGLE",
  payingParticipant: true,
  capabilityRequests: [],
  documents: [],
  id: "enrollment",
  organizationId: "org",
  organizationName: "Công ty demo",
  organizationType: "FARM",
  representativeName: "Người đại diện",
  representativeEmail: "owner@example.test",
  businessId: "DEMO-12345",
  hostingMode: "MANAGED_ORG",
  status: "APPROVED",
  onboardingStage: "ACTIVE_LEGACY",
  version: 1,
  createdAt: "2026-10-17T00:00:00.000Z",
  reviewNote: null,
  serviceActivatedAt: null,
  serviceActivationReason: null,
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
    if (path === "/enterprise-enrollments/enrollment") return current as never;
    if (path === "/enterprise-enrollments") return [current] as never;
    if (path === "/reference-data/addresses")
      return [
        {
          code: "01",
          name: "Thành phố Hà Nội",
          wards: [{ code: "00004", name: "Phường Ba Đình" }],
        },
      ] as never;
    if (path === "/auth/registration-email-availability")
      return { available: true } as never;
    if (path === "/auth/registration-otp/request")
      return {
        verificationId: "verification",
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        resendAfter: new Date(Date.now() + 60_000).toISOString(),
        queued: true,
      } as never;
    if (path === "/auth/registration-otp/verify")
      return {
        verificationId: "verification",
        token: "p".repeat(43),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
      } as never;
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
async function fillRegistration() {
  const fill = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(new RegExp("^" + label)), {
      target: { value },
    });
  const next = async (heading: string) => {
    fireEvent.submit(
      screen.getByRole("button", { name: "Tiếp tục" }).closest("form")!,
    );
    await screen.findByRole("heading", { name: heading });
  };
  fill("Tên doanh nghiệp", "Doanh nghiệp demo");
  fill("Mã số thuế / định danh pháp lý", "0123456789");
  fill("Số giấy chứng nhận đăng ký", "REG-001");
  fireEvent.change(screen.getByLabelText("Tải giấy đăng ký của tổ chức"), {
    target: {
      files: [new File(["registration"], "registration.pdf", { type: "application/pdf" })],
    },
  });
  await screen.findByRole("option", { name: "Thành phố Hà Nội" });
  fill("Tỉnh / thành phố", "01");
  fill("Xã / phường", "00004");
  fill("Địa chỉ trụ sở / nơi hoạt động", "123 Đường kiểm thử");
  await next("Đại diện & tài khoản");
  fill("Họ tên người đại diện", "Chủ doanh nghiệp");
  fill("Chức vụ", "Giám đốc");
  fill("Số điện thoại liên hệ", "0900000123");
  fill("Email liên hệ", "owner@example.test");
  fill("Họ tên quản trị viên", "Chủ doanh nghiệp");
  fill("Email đăng nhập", "owner@example.test");
  expect(screen.queryByLabelText(/^Mật khẩu/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Lưu nháp" }));
  expect(
    localStorage.getItem("agritrace:enterprise-registration-draft:v5"),
  ).toContain("owner@example.test");
  await next("Thông tin hoạt động");
  fill("Nhóm sản phẩm chính", "Rau, gạo");
  await next("Dịch vụ sử dụng");
  fill("Giới thiệu ngắn về tổ chức", "Sản xuất nông sản sạch phục vụ kiểm thử.");
  await next("Kiểm tra & gửi hồ sơ");
  expect(screen.queryByRole("button", { name: /Xác thực tài khoản/ })).toBeNull();
  fireEvent.click(screen.getByRole("checkbox", { name: /Tôi xác nhận/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đồng ý với/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Tôi đã đọc/ }));
  return screen
    .getByRole("button", { name: "Gửi hồ sơ xét duyệt" })
    .closest("form")!;
}

/** "Gửi hồ sơ xét duyệt" opens the OTP dialog for the login email. */
async function submitWithOtp(form: HTMLFormElement) {
  fireEvent.submit(form);
  const code = await screen.findByLabelText("Mã OTP");
  await waitFor(() => expect(code).toBeEnabled());
  fireEvent.change(code, { target: { value: "123456" } });
  fireEvent.click(
    screen.getByRole("button", { name: "Xác nhận và gửi hồ sơ" }),
  );
}

it("offers six registration roles and limits legal forms by role", async () => {
  render(<RegisterPage />);
  for (const role of [
    "Nhà sản xuất / Hợp tác xã",
    "Nhà chế biến",
    "Nhà vận chuyển",
    "Nhà phân phối",
    "Nhà bán lẻ",
    "Doanh nghiệp có chuỗi cung ứng",
  ])
    expect(screen.getByRole("radio", { name: new RegExp(role) })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Hộ nông dân sản xuất" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Nhà vận chuyển/ }));
  expect(screen.queryByRole("option", { name: "Hộ nông dân sản xuất" })).toBeNull();
});

it("verifies only the login email in a dialog and sends no password", async () => {
  render(<RegisterPage />);
  await submitWithOtp(await fillRegistration());
  await screen.findByRole("heading", {
    name: "Cảm ơn bạn đã đăng ký AgriTrace",
  });
  const otpRequests = vi
    .mocked(request)
    .mock.calls.filter((c) => c[0] === "/auth/registration-otp/request");
  expect(otpRequests).toHaveLength(1);
  expect(JSON.parse(otpRequests[0][1]?.body as string).email).toBe(
    "owner@example.test",
  );
  const body = JSON.parse(
    vi.mocked(request).mock.calls.find((c) => c[0] === "/auth/register")![1]!
      .body as string,
  );
  expect(body.password).toBeUndefined();
  expect(body.emailVerifications).toHaveLength(1);
  expect(body.participationModel).toBe("SINGLE");
  expect(body.details.activities).toEqual(["FARM"]);
}, 20_000);

it("keeps the original registration only in memory after a lost response", async () => {
  const normal = vi.mocked(request).getMockImplementation()!;
  let writes = 0;
  vi.mocked(request).mockImplementation(async (path, options, auth) => {
    if (path === "/auth/register") {
      if (writes++ === 0) throw new TypeError("Mất kết nối");
      return {} as never;
    }
    return normal(path, options, auth);
  });
  render(<RegisterPage />);
  const form = await fillRegistration();
  await submitWithOtp(form);
  // An unknown result keeps the original form; the same button reconciles it.
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", { name: /Tôi xác nhận/ }),
    ).toBeDisabled(),
  );
  expect(screen.queryByRole("button", { name: /Thử lại/ })).toBeNull();
  fireEvent.submit(form);
  await screen.findByRole("heading", {
    name: "Cảm ơn bạn đã đăng ký AgriTrace",
  });
  const calls = vi
    .mocked(request)
    .mock.calls.filter((c) => c[0] === "/auth/register");
  expect(calls[0][1]?.body).toBe(calls[1][1]?.body);
  expect(JSON.parse(calls[0][1]?.body as string).hostingMode).toBe(
    "MANAGED_ORG",
  );
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it("allows corrected input after a definitive registration rejection", async () => {
  const normal = vi.mocked(request).getMockImplementation()!;
  vi.mocked(request).mockImplementation(async (path, options, auth) => {
    if (path === "/auth/register")
      throw Object.assign(new Error("Email đã đăng ký"), { status: 409 });
    return normal(path, options, auth);
  });
  render(<RegisterPage />);
  await submitWithOtp(await fillRegistration());
  await screen.findByRole("alert");
  expect(screen.getByRole("checkbox", { name: /Tôi xác nhận/ })).toBeEnabled();
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
  await waitFor(() => expect(submit).toBeEnabled());
  expect(screen.queryByRole("button", { name: /Thử lại/ })).toBeNull();
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
it("prevents duplicate requests for a chain with an open connection, but allows retry after a known failure", async () => {
  current.connections = [
    {
      id: "connection",
      chainId: "own-chain",
      hostingMode: "MANAGED_ORG",
      status: "UNKNOWN",
      version: 1,
      publicConfig: {},
      createdAt: new Date().toISOString(),
    },
  ];
  const view = render(<EnterprisePage />);
  await screen.findByText(/Các chuỗi hiện có đã có yêu cầu/);
  expect(
    screen.queryByRole("button", { name: "Gửi yêu cầu kết nối" }),
  ).toBeNull();
  view.unmount();
  current.connections[0].status = "FAILED";
  render(<EnterprisePage />);
  await screen.findByRole("button", { name: "Gửi yêu cầu kết nối" });
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
  expect(
    vi
      .mocked(request)
      .mock.calls.filter((call) => String(call[0]).endsWith("/review")),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
  fireEvent.click(screen.getByRole("button", { name: "Phê duyệt" }));
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận phê duyệt" }));
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
