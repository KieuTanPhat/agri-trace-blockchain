import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const id = "11111111-1111-4111-8111-111111111111",
  account = "55555555-5555-4555-8555-555555555555",
  connection = "88888888-8888-4888-8888-888888888888";
const routes: [string, string, string][] = [
  ["/admin/audit-log", "admin-audit-log", "Nhật ký kiểm toán nền tảng"],
  [
    `/admin/compliance-assignments/${id}`,
    "admin-compliance-assignments-detail",
    "Chi tiết phân công kiểm định",
  ],
  [
    "/admin/compliance-assignments/new",
    "admin-compliance-assignments-new",
    "Phân công kiểm định mới",
  ],
  [
    "/admin/compliance-assignments",
    "admin-compliance-assignments",
    "Phân công kiểm định",
  ],
  [
    `/admin/enterprises/${id}/connections/${connection}`,
    "admin-enterprises-detail-connections-detail",
    "Xét kết nối blockchain",
  ],
  [
    `/admin/enterprises/${id}`,
    "admin-enterprises-detail",
    "HTX Hồ sơ kiểm thử",
  ],
  [
    `/admin/enterprises/amendments/${id}`,
    "admin-enterprises-amendments-detail",
    "Điều chỉnh hồ sơ · HTX Hồ sơ kiểm thử",
  ],
  [
    "/admin/enterprises/amendments",
    "admin-enterprises-amendments",
    "Điều chỉnh hồ sơ doanh nghiệp",
  ],
  ["/admin/enterprises", "admin-enterprises", "Hồ sơ đăng ký doanh nghiệp"],
  ["/admin/inbox", "admin-inbox", "Hàng đợi quyết định"],
  ["/admin/inspectors", "admin-inspectors", "Người kiểm định"],
  [
    "/admin/organizations/new",
    "admin-organizations-new",
    "Tạo tổ chức kiểm định",
  ],
  ["/admin/organizations", "admin-organizations", "Danh bạ tổ chức"],
  ["/admin", "admin", "Tổng quan nền tảng"],
  ["/admin/roles", "admin-roles", "Vai trò nền tảng"],
  ["/admin/security", "admin-security", "Xác thực hai yếu tố"],
  ["/admin/settings", "admin-settings", "Tham số hệ thống"],
  [`/admin/users/${account}`, "admin-users-detail", "Người vận hành kiểm thử"],
  ["/admin/users/new", "admin-users-new", "Tạo tài khoản nền tảng"],
  ["/admin/users", "admin-users", "Tài khoản nền tảng"],
];
for (const [url, name, heading] of routes)
  test(`canonical Ledger governance route ${url}`, async ({ page, api }) => {
    await api.useActor("platform-admin");
    await api.scenario("governance.registry");
    await page.goto(url);
    await expect(page.getByTestId(`ledger-screen-${name}`)).toBeVisible();
    if (
      url.endsWith("/new") &&
      ["admin-users-new"].includes(name)
    ) {
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", {
            name: name === "admin-users-new" ? "Tạo tài khoản" : heading,
            exact: true,
          }),
      ).toBeVisible();
    } else
      await expect(
        page.getByRole("heading", { level: 1, name: heading, exact: true }),
      ).toBeVisible();
    await expect(
      page.getByText("[object Object]", { exact: true }),
    ).toHaveCount(0);
  });

test("organization detail keeps its baseline query URL and auditor directory remains reachable", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto("/admin/organizations");
  await page
    .getByRole("button", { name: "Tổ chức kiểm định", exact: true })
    .click();
  await expect(
    page.getByText("Tổ chức kiểm định kiểm thử", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Doanh nghiệp", exact: true }).click();
  await page.getByText("HTX Hồ sơ kiểm thử", { exact: true }).click();
  await expect(page).toHaveURL(
    /\/admin\/organizations\?organizationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/,
  );
  await expect(
    page.getByRole("heading", { name: "HTX Hồ sơ kiểm thử", exact: true }),
  ).toBeVisible();
});

test("audit verifies its hash chain and exports CSV using the applied organization filter", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(
    "/admin/audit-log?organizationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );
  await page
    .getByRole("button", { name: "Kiểm chuỗi băm", exact: true })
    .click();
  await expect(
    page.getByText("Chuỗi toàn vẹn · đã kiểm 0 bản ghi", { exact: true }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Xuất CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("fixture-audit.csv");
  expect(
    api
      .requests()
      .some(
        (r) =>
          r.path.startsWith("/platform-audit/export?") &&
          r.path.includes(
            "organizationId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          ),
      ),
  ).toBe(true);
});
