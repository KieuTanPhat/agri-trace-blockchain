import { test, expect } from "./fixtures";
import { fillIndividualRegistration } from "./fixtures/auth";
test("expired password gates business access", async ({ page, api }) => {
  await api.useActor("org-owner");
  await api.scenario("auth.expired-password");
  await page.goto("/enterprise");
  await expect(page).toHaveURL(/\/account\/password/);
  await expect(
    page.getByRole("heading", { name: /Đổi mật khẩu/ }),
  ).toBeVisible();
  await expect(page.getByTestId("ledger-private-root")).toBeVisible();
});
test("anonymous access stays at Ledger login", async ({ page, api }) => {
  await api.useActor("anonymous");
  await api.scenario("auth.anonymous");
  await page.goto("/admin/enterprises");
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("heading", { name: "Đăng nhập Agritrace", exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("ledger-private-root")).toHaveCount(0);
});
test("login_requires_mfa and wrong_mfa_keeps_login", async ({ page, api }) => {
  await api.useActor("anonymous");
  await api.scenario("auth.mfa-required");
  await page.goto("/login");
  await page
    .getByLabel("Email", { exact: true })
    .fill("platform-admin@example.invalid");
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("Fixture-password-2026!");
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await expect(
    page.getByLabel("Mã xác thực hai yếu tố", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Mã xác thực hai yếu tố", { exact: true })
    .fill("000000");
  await page
    .getByRole("button", { name: "Xác minh và đăng nhập", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mã xác thực không hợp lệ" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  expect(api.requests().filter((r) => r.path === "/auth/login")).toHaveLength(
    2,
  );
});
test("invitation_activation uses the baseline token and stable request ID", async ({
  page,
  api,
}) => {
  await api.useActor("anonymous");
  await api.scenario("auth.invitation");
  await page.goto(
    `/join-organization?id=11111111-1111-4111-8111-111111111111&token=${"a".repeat(43)}`,
  );
  await expect(
    page.getByRole("heading", {
      name: "Nhận lời mời tham gia doanh nghiệp",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByLabel("Mật khẩu", { exact: true })
    .fill("Fixture-password-2026!");
  await page
    .getByLabel("Nhập lại mật khẩu", { exact: true })
    .fill("Fixture-password-2026!");
  await page
    .getByRole("button", { name: "Kích hoạt tài khoản", exact: true })
    .click();
  await expect(
    page.getByText("Tài khoản đã được kích hoạt", { exact: true }),
  ).toBeVisible();
  expect(
    api.requests().filter((r) => r.path === "/auth/member-invitations/accept"),
  ).toHaveLength(1);
});
test("otp_expiry_preserves_registration without sending an unverified profile", async ({
  page,
  api,
}) => {
  await api.useActor("anonymous");
  await api.scenario("auth.otp-expired");
  await page.goto("/register");
  await expect(page.getByTestId("ledger-registration")).toBeVisible();
  await fillIndividualRegistration(page);
  await page
    .getByRole("button", { name: "Gửi hồ sơ xét duyệt", exact: true })
    .click();
  await page.getByLabel("Mã OTP", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Xác thực và gửi hồ sơ", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mã xác thực đã hết hạn" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đóng", exact: true }).click();
  await expect(
    page.getByText("Hộ sản xuất kiểm thử", { exact: true }),
  ).toBeVisible();
  expect(
    api.requests().filter((r) => r.path === "/auth/register"),
  ).toHaveLength(0);
});
test("password change confirms once, sends the baseline body and signs out", async ({
  page,
  api,
}) => {
  await api.useActor("org-owner");
  await api.scenario("auth.password-change");
  await page.goto("/account/password");
  await page
    .getByLabel("Mật khẩu tạm", { exact: true })
    .fill("Fixture-temporary-2026!");
  await page
    .getByLabel("Mật khẩu mới", { exact: true })
    .fill("Fixture-replacement-2026!");
  await page
    .getByLabel("Nhập lại mật khẩu mới", { exact: true })
    .fill("Fixture-replacement-2026!");
  await page.getByRole("button", { name: "Đổi mật khẩu", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Xác nhận đổi mật khẩu",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Đổi mật khẩu", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login/);
  expect(
    api.requests().filter((r) => r.path === "/auth/change-password"),
  ).toHaveLength(1);
  expect(api.requests().filter((r) => r.path === "/auth/logout")).toHaveLength(
    1,
  );
});
test("registration submits only after verified OTP and retains the temporary-password mail flow", async ({
  page,
  api,
}) => {
  await api.useActor("anonymous");
  await api.scenario("auth.registration");
  await page.goto("/register");
  await fillIndividualRegistration(page);
  await page
    .getByRole("button", { name: "Gửi hồ sơ xét duyệt", exact: true })
    .click();
  expect(
    api.requests().filter((r) => r.path === "/auth/register"),
  ).toHaveLength(0);
  await page.getByLabel("Mã OTP", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Xác thực và gửi hồ sơ", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Đã gửi hồ sơ xét duyệt", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Thông tin đăng nhập được gửi qua email/),
  ).toBeVisible();
  expect(
    api.requests().filter((r) => r.path === "/auth/register"),
  ).toHaveLength(1);
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((value) =>
        String(value).includes("fixture-proof"),
      ),
    ),
  ).toBe(false);
});
