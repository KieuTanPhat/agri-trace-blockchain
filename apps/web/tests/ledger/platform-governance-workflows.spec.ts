import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const id = "11111111-1111-4111-8111-111111111111",
  account = "55555555-5555-4555-8555-555555555555",
  connection = "88888888-8888-4888-8888-888888888888";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const proposals: [string, Record<string, string>, Record<string, unknown>][] = [
  [
    "CAPABILITY_GRANT",
    { organizationId: org, code: "FARM" },
    { organizationId: org, code: "FARM" },
  ],
  [
    "CREATE_CHAIN_GRANT",
    { organizationId: org, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    { organizationId: org, userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  ],
  [
    "SYSTEM_ADMIN_CREATE",
    {
      email: "new@example.invalid",
      fullName: "Quản trị mới",
      roleCode: "PLATFORM_OPERATOR",
    },
    {
      email: "new@example.invalid",
      fullName: "Quản trị mới",
      roleCode: "PLATFORM_OPERATOR",
    },
  ],
  [
    "ADMIN_PASSWORD_RESET",
    { userId: account },
    { userId: account, temporaryPassword: "Fixture-Temporary-123" },
  ],
  [
    "CONNECTION_APPROVE",
    {
      connectionId: connection,
      version: "5",
      note: "Đối chiếu kết nối đầy đủ",
    },
    { connectionId: connection, version: 5, note: "Đối chiếu kết nối đầy đủ" },
  ],
  [
    "CAPABILITY_REQUEST_APPROVE",
    {
      requestId: "22222222-2222-4222-8222-222222222222",
      version: "1",
      note: "Đối chiếu năng lực đầy đủ",
    },
    {
      requestId: "22222222-2222-4222-8222-222222222222",
      version: 1,
      note: "Đối chiếu năng lực đầy đủ",
    },
  ],
  ["PLAN_VERSION_PUBLISH", { versionId: id }, { versionId: id }],
  [
    "INVOICE_CONFIRM_PAYMENT",
    { invoiceId: id, version: "2", reference: "BANK-FIXTURE" },
    { invoiceId: id, version: 2, reference: "BANK-FIXTURE" },
  ],
  [
    "SETTING_CHANGE",
    { key: "enrollment.slaHours", value: "24", version: "3" },
    { key: "enrollment.slaHours", value: 24, version: 3 },
  ],
  [
    "QR_BLOCK",
    { lotId: id, publicMessage: "Đang đối soát thông tin" },
    { lotId: id, publicMessage: "Đang đối soát thông tin" },
  ],
];
for (const [operation, initial, params] of proposals)
  test(`canonical proposal form preserves ${operation} parameters`, async ({
    page,
    api,
  }) => {
    await api.useActor("platform-admin");
    await api.scenario("governance.registry");
    const query = new URLSearchParams({ operation, ...initial });
    if (operation === "INVOICE_CONFIRM_PAYMENT") query.delete("version");
    await page.goto("/admin/approvals/new?" + query.toString());
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    if (operation === "ADMIN_PASSWORD_RESET")
      await dialog
        .getByLabel("Mật khẩu tạm", { exact: true })
        .fill("Fixture-Temporary-123");
    if (operation === "INVOICE_CONFIRM_PAYMENT")
      await dialog.getByLabel("Phiên bản hiện tại", { exact: true }).fill("2");
    if (operation === "CREATE_CHAIN_GRANT")
      await expect(
        dialog.getByLabel("Thành viên được cấp quyền tạo chuỗi", {
          exact: true,
        }),
      ).toContainText("Thành viên kiểm thử");
    if (operation === "CONNECTION_APPROVE")
      await expect(
        dialog.getByLabel("Kết nối chờ xét", { exact: true }),
      ).toContainText("FixtureMSP");
    if (operation === "CAPABILITY_REQUEST_APPROVE")
      await expect(
        dialog.getByLabel("Yêu cầu năng lực chờ xét", { exact: true }),
      ).toContainText("FARM");
    await dialog
      .getByLabel("Lý do đề xuất", { exact: true })
      .fill("Đề xuất sau đối chiếu độc lập");
    await dialog
      .getByLabel("Mã xác thực hai yếu tố", { exact: true })
      .fill("123456");
    await dialog
      .getByRole("button", { name: "Gửi đề xuất", exact: true })
      .click();
    await expect(page).toHaveURL(/\/admin\/approvals$/);
    const writes = api
      .requests()
      .filter((r) => r.method === "POST" && r.path === "/platform-approvals");
    expect(writes).toHaveLength(1);
    expect(JSON.parse(writes[0].body!)).toEqual({
      operation,
      params,
      reason: "Đề xuất sau đối chiếu độc lập",
    });
    expect(writes[0].mfaCode).toBe("123456");
    expect(writes[0].idempotencyKey).toBeTruthy();
  });
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
test("a rejected MFA step-up keeps the session and allows correction", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.checker-wrong-mfa");
  await page.goto(`/admin/approvals/${id}`);
  await page
    .getByLabel("Ghi chú quyết định", { exact: true })
    .fill("Đã kiểm tra độc lập hồ sơ");
  const mfa = page.getByLabel("Mã xác thực hai yếu tố", { exact: true });
  await mfa.fill("000000");
  await page
    .getByRole("button", { name: "Ghi quyết định cuối cùng", exact: true })
    .click();
  await expect(
    page.getByText("Mã xác thực không đúng", { exact: true }),
  ).toBeVisible();
  await expect(mfa).toBeEnabled();
  await mfa.fill("123456");
  await page
    .getByRole("button", { name: "Ghi quyết định cuối cùng", exact: true })
    .click();
  await expect(
    page.getByText("Đã phê duyệt", { exact: true }).first(),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/admin/approvals/${id}$`));
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path.endsWith("/decision")),
  ).toHaveLength(2);
});
for (const scenario of ["governance.registry", "governance.expired-proposal"])
  test(`proposal cancellation follows maker/expiry rules ${scenario}`, async ({
    page,
    api,
  }) => {
    await api.useActor("platform-admin");
    await api.scenario(scenario);
    await page.goto(`/admin/approvals/${id}`);
    await page
      .getByRole("button", { name: "Hủy đề xuất", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByLabel("Lý do hủy", { exact: true })
      .fill("Rút đề xuất để đối chiếu lại");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Hủy đề xuất", exact: true })
      .click();
    await expect(
      page.getByText("Đã hủy", { exact: true }).first(),
    ).toBeVisible();
    expect(
      api
        .requests()
        .filter((r) => r.method === "POST" && r.path.endsWith("/cancel")),
    ).toHaveLength(1);
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
