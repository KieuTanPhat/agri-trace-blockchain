import { actorSession } from "./actors";
import { z } from "zod";
import type { Page } from "@playwright/test";
import type { components } from "../../../src/lib/generated/api";
import {
  registerScenario,
  type CapturedRequest,
  type FixtureState,
  type FixtureResponse,
} from "./scenarios";
function body(request: CapturedRequest): Record<string, unknown> {
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(request.body ?? "{}"));
}
const noop = () => undefined;
registerScenario("auth.anonymous", { handle: noop });
registerScenario("auth.expired-password", {
  configure: (state) => {
    if (state.session) state.session.user.mustChangePassword = true;
  },
  handle: noop,
});
registerScenario("auth.password-change", {
  configure: (state) => {
    if (state.session) state.session.user.mustChangePassword = true;
  },
  handle: (request) => {
    if (request.path !== "/auth/change-password" || request.method !== "POST")
      return;
    const input = body(request);
    if (
      input.currentPassword !== "Fixture-temporary-2026!" ||
      input.newPassword !== "Fixture-replacement-2026!"
    )
      throw new Error("Password DTO mismatch");
    return { data: { changed: true } };
  },
});
registerScenario("auth.organization-switch", { handle: noop });
registerScenario("auth.mfa-required", {
  handle: (request, state) => {
    if (request.path !== "/auth/login" || request.method !== "POST") return;
    const input = body(request);
    if (
      input.email !== "platform-admin@example.invalid" ||
      input.password !== "Fixture-password-2026!"
    )
      throw new Error("Login DTO differs from entered fixture credentials");
    if (!input.mfaCode)
      return {
        status: 401,
        error: { code: "UNAUTHORIZED", message: "Cần mã xác thực hai yếu tố" },
      };
    if (input.mfaCode !== "123456")
      return {
        status: 401,
        error: { code: "UNAUTHORIZED", message: "Mã xác thực không hợp lệ" },
      };
    state.session = actorSession("platform-admin");
    return { data: state.session };
  },
});
registerScenario("auth.invitation", {
  handle: (request) => {
    if (
      request.path !== "/auth/member-invitations/accept" ||
      request.method !== "POST"
    )
      return;
    const input = body(request);
    if (
      input.invitationId !== "11111111-1111-4111-8111-111111111111" ||
      input.token !== "a".repeat(43) ||
      typeof input.password !== "string" ||
      typeof input.requestId !== "string"
    )
      throw new Error("Invitation DTO differs from baseline");
    return { status: 201, data: { record: { accepted: true } } };
  },
});
registerScenario("auth.otp-expired", {
  handle: (request) => {
    if (
      request.path === "/reference-data/addresses" &&
      request.method === "GET"
    )
      return {
        data: [
          {
            code: "79",
            name: "Thành phố Hồ Chí Minh",
            wards: [{ code: "001", name: "Phường kiểm thử" }],
          },
        ],
      };
    if (
      request.path === "/auth/registration-email-availability" &&
      request.method === "POST"
    ) {
      const input = body(request);
      if (
        !["owner@example.invalid", "contact@example.invalid"].includes(
          String(input.email),
        )
      )
        throw new Error("Wrong availability email");
      return { data: { available: true } };
    }
    if (
      request.path === "/auth/registration-otp/request" &&
      request.method === "POST"
    ) {
      const input = body(request);
      if (
        input.email !== "owner@example.invalid" ||
        typeof input.registrationId !== "string" ||
        input.requestId !== request.idempotencyKey
      )
        throw new Error("OTP issuance identity mismatch");
      return {
        data: {
          verificationId: "33333333-3333-4333-8333-333333333333",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          resendAfter: new Date(Date.now() + 60_000).toISOString(),
          queued: true,
        },
      };
    }
    if (
      request.path === "/auth/registration-otp/verify" &&
      request.method === "POST"
    ) {
      const input = body(request);
      if (
        input.code !== "123456" ||
        input.verificationId !== "33333333-3333-4333-8333-333333333333" ||
        input.attemptId !== request.idempotencyKey
      )
        throw new Error("OTP verification identity mismatch");
      return {
        status: 400,
        error: { code: "OTP_EXPIRED", message: "Mã xác thực đã hết hạn" },
      };
    }
  },
});
registerScenario("auth.registration", {
  handle: (request, state) => {
    if (
      request.path === "/reference-data/addresses" &&
      request.method === "GET"
    )
      return {
        data: [
          {
            code: "79",
            name: "Thành phố Hồ Chí Minh",
            wards: [{ code: "001", name: "Phường kiểm thử" }],
          },
        ],
      };
    if (
      request.path === "/auth/registration-email-availability" &&
      request.method === "POST"
    )
      return { data: { available: true } };
    if (
      request.path === "/auth/registration-otp/request" &&
      request.method === "POST"
    ) {
      const input = body(request);
      if (input.requestId !== request.idempotencyKey)
        throw new Error("Issuance key mismatch");
      state.values.set("registrationId", input.registrationId);
      return {
        data: {
          verificationId: "33333333-3333-4333-8333-333333333333",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
          resendAfter: new Date().toISOString(),
          queued: true,
        } satisfies components["schemas"]["RegistrationOtpReceipt"],
      };
    }
    if (
      request.path === "/auth/registration-otp/verify" &&
      request.method === "POST"
    ) {
      const input = body(request);
      if (input.code !== "123456" || input.attemptId !== request.idempotencyKey)
        throw new Error("OTP mismatch");
      return {
        data: {
          verificationId: "33333333-3333-4333-8333-333333333333",
          token: "fixture-proof",
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        } satisfies components["schemas"]["RegistrationOtpVerifiedView"],
      };
    }
    if (request.path === "/auth/register" && request.method === "POST") {
      const input = body(request),
        details = z.record(z.string(), z.unknown()).parse(input.details);
      if (
        input.requestId !== state.values.get("registrationId") ||
        input.email !== "owner@example.invalid" ||
        input.organizationName !== "Hộ sản xuất kiểm thử" ||
        details.formVersion !== 2 ||
        details.legalForm !== "INDIVIDUAL_PRODUCER" ||
        !details.declarationAccepted ||
        !details.termsAccepted ||
        !details.privacyAcknowledged ||
        "password" in input
      )
        throw new Error(
          "Registration does not preserve the acknowledged baseline DTO",
        );
      return {
        status: 201,
        data: {
          enrollmentId: "44444444-4444-4444-8444-444444444444",
          status: "PENDING_REVIEW",
        } satisfies components["schemas"]["EnterpriseRegistrationReceiptDto"],
      };
    }
  },
});
export async function fillIndividualRegistration(page: Page): Promise<void> {
  await page
    .getByLabel("Tên tổ chức / chủ thể", { exact: true })
    .fill("Hộ sản xuất kiểm thử");
  await page.getByLabel("Loại chủ thể", { exact: true }).click();
  await page
    .getByRole("option", { name: "Cá nhân sản xuất", exact: true })
    .click();
  await page.getByLabel("Tỉnh / thành phố", { exact: true }).click();
  await page
    .getByRole("option", { name: "Thành phố Hồ Chí Minh", exact: true })
    .click();
  await page.getByLabel("Xã / phường", { exact: true }).click();
  await page
    .getByRole("option", { name: "Phường kiểm thử", exact: true })
    .click();
  await page
    .getByLabel("Địa chỉ chi tiết", { exact: true })
    .fill("Số 1 đường kiểm thử");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page
    .getByLabel("Người đại diện / chủ hồ sơ", { exact: true })
    .fill("Nguyễn An");
  await page.getByLabel("Số điện thoại", { exact: true }).fill("0912345678");
  await page
    .getByLabel("Email liên hệ", { exact: true })
    .fill("contact@example.invalid");
  await page
    .getByLabel("Họ tên quản trị viên", { exact: true })
    .fill("Nguyễn An");
  await page
    .getByLabel("Email đăng nhập", { exact: true })
    .fill("owner@example.invalid");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByLabel("Nhóm sản phẩm", { exact: true }).fill("Xoài, Cam");
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  await page
    .getByLabel("Xác nhận thông tin chính xác", { exact: true })
    .check();
  await page.getByLabel("Đồng ý điều khoản sử dụng", { exact: true }).check();
  await page
    .getByLabel("Đã đọc chính sách quyền riêng tư", { exact: true })
    .check();
}
export function defaultAuthResponse(
  request: CapturedRequest,
  state: FixtureState,
): FixtureResponse | undefined {
  if (request.path === "/auth/refresh" && request.method === "POST")
    return state.session
      ? { data: state.session }
      : {
          status: 401,
          error: {
            code: "UNAUTHORIZED",
            message: "Phiên đăng nhập đã hết hạn",
          },
        };
  if (request.path === "/auth/me" && request.method === "GET")
    return state.session
      ? { data: state.session.user }
      : {
          status: 401,
          error: { code: "UNAUTHORIZED", message: "Chưa đăng nhập" },
        };
  if (request.path === "/auth/logout" && request.method === "POST") {
    state.session = null;
    return { data: { loggedOut: true } };
  }
  if (request.path === "/chain-permissions" && request.method === "GET")
    return state.session?.user.mustChangePassword
      ? {
          status: 403,
          error: { code: "FORBIDDEN", message: "Cần đổi mật khẩu" },
        }
      : { data: { accessRevision: "a".repeat(64), productionChains: [] } };
  if (request.path === "/enterprise-access" && request.method === "GET")
    return {
      data: {
        stage: "ACTIVE",
        owner: state.actor === "org-owner",
        primary: state.actor === "org-owner",
        tier:
          state.actor === "org-staff"
            ? 3
            : state.actor === "org-manager"
              ? 2
              : 1,
        permissions: [],
        capabilities: [],
      },
    };
  return undefined;
}
