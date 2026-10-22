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
import EnterprisePage from "./connections/page";
import PlatformEnrollment from "@/components/workspace/platform-enrollment";
import {LedgerConfirmProvider} from "@/components/ledger/confirm-provider";
const EnterpriseAdminPage = () => <LedgerConfirmProvider><PlatformEnrollment id="enrollment" /></LedgerConfirmProvider>;

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
