import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const id = "11111111-1111-4111-8111-111111111111",
  account = "55555555-5555-4555-8555-555555555555",
  connection = "88888888-8888-4888-8888-888888888888";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("locked account unlock retains optimistic version", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.locked-account");
  await page.goto(`/admin/users/${account}`);
  await page
    .getByRole("button", {
      name: "Thao tác với Người vận hành kiểm thử",
      exact: true,
    })
    .click();
  await page.getByRole("menuitem", { name: "Mở khóa", exact: true }).click();
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Đã xác minh chủ tài khoản");
  await page.getByRole("button", { name: "Mở khóa", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const write = api
    .requests()
    .find((r) => r.method === "POST" && r.path.endsWith("/unlock"));
  expect(JSON.parse(write!.body!)).toEqual({
    version: 4,
    reason: "Đã xác minh chủ tài khoản",
  });
});
test("connection review keeps its own version and canonical detail URL", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/enterprises/${id}/connections/${connection}`);
  await page.getByRole("button", { name: "Xét kết nối", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Ghi chú", { exact: true })
    .fill("Kết nối đã được xác minh");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ghi quyết định", exact: true })
    .click();
  await expect(
    page.getByText("Kết nối đã được xác minh", { exact: true }),
  ).toBeVisible();
  const write = api
    .requests()
    .find(
      (r) => r.method === "POST" && r.path.includes("/enterprise-connections/"),
    );
  expect(JSON.parse(write!.body!)).toMatchObject({
    version: 5,
    decision: "APPROVE",
    note: "Kết nối đã được xác minh",
  });
  await expect(page).toHaveURL(new RegExp(`/connections/${connection}$`));
});
test("capability review uses the capability version independently of enrollment", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/enterprises/${id}`);
  await page.getByRole("button", { name: "Xét năng lực", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Ghi chú gửi doanh nghiệp", { exact: true })
    .fill("Đã kiểm tra năng lực khai báo");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Ghi quyết định", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Xét năng lực", exact: true }),
  ).toHaveCount(0);
  const write = api
    .requests()
    .find(
      (r) => r.method === "POST" && r.path.startsWith("/capability-requests/"),
    );
  expect(JSON.parse(write!.body!)).toMatchObject({
    version: 1,
    decision: "APPROVE",
  });
});
test("amendment evidence is authorized at download and review retains the amendment version", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/enterprises/amendments/${id}`);
  await expect(page.getByText("HTX-002", { exact: false })).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Tải tệp chung-cu.pdf", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("chung-cu.pdf");
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Đối chiếu đầy đủ chứng cứ");
  await page
    .getByRole("button", { name: "Ghi quyết định", exact: true })
    .click();
  await expect(
    page.getByText("Đã duyệt", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Lý do", { exact: true })).toHaveCount(0);
  const write = api
    .requests()
    .find(
      (r) =>
        r.method === "POST" &&
        r.path.startsWith("/enterprise-profile-amendments/"),
    );
  expect(JSON.parse(write!.body!)).toMatchObject({
    version: 2,
    decision: "APPROVE",
  });
});
test("MFA unknown results require status inspection without replaying secret writes", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.mfa-unknown");
  await page.goto("/admin/security");
  await page
    .getByLabel("Mật khẩu hiện tại", { exact: true })
    .fill("fixture-current-password");
  await page
    .getByRole("button", { name: "Bắt đầu đăng ký MFA", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Kiểm tra trạng thái MFA", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Mật khẩu hiện tại", { exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Kiểm tra trạng thái MFA", exact: true })
    .click();
  await expect(page.getByText("Chờ xác nhận", { exact: true })).toBeVisible();
  await expect(
    page.getByLabel("Mật khẩu hiện tại", { exact: true }),
  ).toHaveValue("");
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path === "/auth/mfa/enroll"),
  ).toHaveLength(1);
});
test("MFA regeneration and disable each require a single confirmation", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.mfa-enabled");
  await page.goto("/admin/security");
  await page.getByLabel("Mã xác thực", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Tạo lại mã khôi phục", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo mã mới", exact: true })
    .click();
  await expect(
    page.getByText("fixture-replacement-code", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Mã xác thực", { exact: true }).fill("234567");
  await page.getByRole("button", { name: "Tắt MFA", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tắt MFA", exact: true })
    .click();
  await expect(page.getByText("Chưa bật MFA", { exact: true })).toBeVisible();
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path.startsWith("/auth/mfa/")),
  ).toHaveLength(2);
});
test("canonical new auditor organization and new account send baseline payloads", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto("/admin/organizations/new");
  await page.getByLabel("Tên tổ chức", { exact: true }).fill("Kiểm định mới");
  await page
    .getByRole("button", { name: "Tạo tổ chức kiểm định", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/organizations$/);
  expect(
    JSON.parse(
      api
        .requests()
        .find((r) => r.method === "POST" && r.path === "/organizations")!.body!,
    ),
  ).toEqual({ type: "AUDITOR", name: "Kiểm định mới" });
  await page.goto("/admin/users/new");
  await page
    .getByRole("dialog")
    .getByLabel("Email", { exact: true })
    .fill("new@example.invalid");
  await page
    .getByRole("dialog")
    .getByLabel("Họ tên", { exact: true })
    .fill("Tài khoản mới");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tạo tài khoản", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  const body = JSON.parse(
    api.requests().find((r) => r.method === "POST" && r.path === "/users")!
      .body!,
  );
  expect(body).toEqual({
    email: "new@example.invalid",
    fullName: "Tài khoản mới",
    roleCode: "PLATFORM_OPERATOR",
  });
});
test("assignment creation uses real farm and active reviewer selectors", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto("/admin/compliance-assignments/new");
  await page.getByLabel("Vùng trồng", { exact: true }).click();
  await page
    .getByRole("option", {
      name: "Vùng trồng kiểm thử · HTX Hồ sơ kiểm thử",
      exact: true,
    })
    .click();
  await page.getByLabel("Người kiểm định", { exact: true }).click();
  await page
    .getByRole("option", {
      name: "Người kiểm định kiểm thử · Tổ chức kiểm định kiểm thử",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Lý do phân công", { exact: true })
    .fill("Phạm vi kiểm định được phân công");
  await page
    .getByRole("button", { name: "Ghi phân công", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/compliance-assignments$/);
  expect(
    JSON.parse(
      api
        .requests()
        .find(
          (r) => r.method === "POST" && r.path === "/compliance/assignments",
        )!.body!,
    ),
  ).toEqual({
    farmId: id,
    reviewerUserId: "77777777-7777-4777-8777-777777777777",
    reason: "Phạm vi kiểm định được phân công",
  });
});
test("account reset and session revocation retain their distinct baseline payloads", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/users/${account}`);
  await page
    .getByRole("button", {
      name: "Thao tác với Người vận hành kiểm thử",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Đặt mật khẩu tạm", exact: true })
    .click();
  await page.getByLabel("Mật khẩu tạm", { exact: true }).fill("ệệệệ");
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Đặt lại theo yêu cầu xác minh");
  await page
    .getByRole("button", { name: "Đặt mật khẩu tạm", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", {
      name: "Thao tác với Người vận hành kiểm thử",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Thu hồi mọi phiên", exact: true })
    .click();
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Thu hồi sau đối soát tài khoản");
  await page
    .getByRole("button", { name: "Thu hồi phiên", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const writes = api
    .requests()
    .filter((r) => r.method === "POST" && r.path.startsWith("/users/"));
  expect(writes).toHaveLength(2);
  expect(JSON.parse(writes[0].body!)).toMatchObject({
    version: 4,
    temporaryPassword: "ệệệệ",
  });
  expect(JSON.parse(writes[1].body!)).toEqual({
    reason: "Thu hồi sau đối soát tài khoản",
  });
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("ệệệệ");
});
