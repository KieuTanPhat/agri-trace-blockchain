import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const id = "11111111-1111-4111-8111-111111111111";
test("manual activation follows the baseline exemption for registrations without capability requests", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.ready-activation");
  await page.goto(`/admin/enterprises/${id}`);
  await page
    .getByLabel("Lý do kích hoạt thủ công", { exact: true })
    .fill("Kích hoạt sau đối chiếu hồ sơ");
  await page
    .getByRole("button", { name: "Kích hoạt dịch vụ", exact: true })
    .click();
  await expect(
    page.getByText("Dịch vụ đang hoạt động", { exact: true }),
  ).toBeVisible();
  const writes = api
    .requests()
    .filter((r) => r.method === "POST" && r.path.endsWith("/activate"));
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0].body!)).toMatchObject({
    version: 4,
    reason: "Kích hoạt sau đối chiếu hồ sơ",
  });
});
test("enrollment retains its organization product read view", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/enterprises/${id}`);
  await expect(
    page.getByText("Xoài kiểm thử đầy đủ", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Sản phẩm hồ sơ tổ chức", { exact: true }),
  ).toBeVisible();
  expect(api.requests().some((r) => r.path === "/catalog")).toBe(true);
  expect(api.requests().some((r) => r.path === "/organizations")).toBe(true);
});
test("compliance assignment detail retains revocation reason and the canonical return URL", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto(`/admin/compliance-assignments/${id}`);
  await expect(
    page.getByTestId("ledger-screen-admin-compliance-assignments-detail"),
  ).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "Vùng trồng kiểm thử" }),
  ).toBeVisible();
  await page
    .getByLabel("Lý do thu hồi", { exact: true })
    .fill("Kết thúc phạm vi kiểm định");
  await page
    .getByRole("button", { name: "Thu hồi phân công", exact: true })
    .click();
  await expect(
    page.getByText("Đã thu hồi", { exact: true }).first(),
  ).toBeVisible();
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path.endsWith("/revoke")),
  ).toHaveLength(1);
  await page
    .getByRole("navigation", { name: "Vị trí", exact: true })
    .getByRole("link", { name: "Phân công kiểm định", exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin\/compliance-assignments$/);
});
test("own MFA enrollment and one-time recovery codes remain in memory", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto("/admin/security");
  await expect(page.getByTestId("ledger-screen-admin-security")).toBeVisible();
  await page
    .getByLabel("Mật khẩu hiện tại", { exact: true })
    .fill("fixture-current-password");
  await page
    .getByRole("button", { name: "Bắt đầu đăng ký MFA", exact: true })
    .click();
  await expect(
    page.getByText("JBSWY3DPEHPK3PXP", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Mã xác thực", { exact: true }).fill("000000");
  await page
    .getByRole("button", { name: "Xác nhận bật MFA", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Mã xác thực không đúng" }),
  ).toBeVisible();
  await page.getByLabel("Mã xác thực", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Xác nhận bật MFA", exact: true })
    .click();
  await expect(
    page.getByText("fixture-recovery-one", { exact: true }),
  ).toBeVisible();
  const storage = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }),
  );
  expect(storage).not.toMatch(
    /fixture-current-password|JBSWY3DPEHPK3PXP|fixture-recovery/,
  );
  await page.reload();
  await expect(page.getByText("Đã bật MFA", { exact: true })).toBeVisible();
  await expect(
    page.getByText("fixture-recovery-one", { exact: true }),
  ).toHaveCount(0);
});
test("governance setting writes a typed value and current version", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  await page.goto("/admin/settings");
  await expect(page.getByTestId("ledger-screen-admin-settings")).toBeVisible();
  await page
    .getByRole("button", { name: "Sửa enrollment.slaHours", exact: true })
    .click();
  await page.getByLabel("Giá trị JSON", { exact: true }).fill("24");
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Rút ngắn thời hạn xem xét");
  await page.getByRole("button", { name: "Ghi tham số", exact: true }).click();
  await expect(page.getByText("24", { exact: true })).toBeVisible();
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path.includes("/settings/")),
  ).toHaveLength(1);
});
test("platform account status retains the current version and reason", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.accounts");
  await page.goto("/admin/users");
  await expect(page.getByTestId("ledger-screen-admin-users")).toBeVisible();
  await page
    .getByRole("button", {
      name: "Thao tác với Người vận hành kiểm thử",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Đổi trạng thái tài khoản", exact: true })
    .click();
  await page.getByRole("radio", { name: "Vô hiệu hóa", exact: true }).click();
  await page
    .getByLabel("Lý do", { exact: true })
    .fill("Ngừng truy cập theo yêu cầu");
  await page
    .getByRole("button", { name: "Ghi trạng thái", exact: true })
    .click();
  await expect(
    page.getByText("Vô hiệu hóa", { exact: true }).first(),
  ).toBeVisible();
  const writes = api.requests().filter((r) => r.method === "PATCH");
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0].body!)).toMatchObject({
    accountStatus: "INACTIVE",
    version: 4,
    reason: "Ngừng truy cập theo yêu cầu",
  });
});
test("auditor cannot perform platform decisions", async ({ page, api }) => {
  await api.useActor("auditor");
  await api.scenario("governance.pending-enrollment");
  await page.goto("/admin/enterprises");
  await expect(
    page.getByRole("heading", { name: "Không có quyền truy cập", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Phê duyệt", exact: true }),
  ).toHaveCount(0);
  expect(
    api.requests().filter((r) => r.path === "/enterprise-enrollments"),
  ).toHaveLength(0);
});
test("enrollment review sends the current version and does not activate a paying producer", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.pending-enrollment");
  await page.goto(`/admin/enterprises/${id}`);
  await expect(
    page.getByTestId("ledger-screen-admin-enterprises-detail"),
  ).toBeVisible();
  await page
    .getByLabel("Ghi chú gửi doanh nghiệp", { exact: true })
    .fill("Hồ sơ đã được xác minh");
  await page
    .getByRole("button", { name: "Ghi quyết định", exact: true })
    .click();
  await expect(page.getByText("Chờ kích hoạt", { exact: true })).toBeVisible();
  expect(
    api
      .requests()
      .filter((r) => r.path.endsWith("/review") && r.method === "POST"),
  ).toHaveLength(1);
  expect(
    api
      .requests()
      .filter((r) => r.path.endsWith("/activate") && r.method === "POST"),
  ).toHaveLength(0);
});
test("private registration document access denial produces no download or optimistic success", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.document-denied");
  const downloads: string[] = [];
  page.on("download", (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.goto(`/admin/enterprises/${id}`);
  await expect(
    page.getByText("giay-dang-ky.pdf", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Tải tệp giay-dang-ky.pdf", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Không còn quyền tải tài liệu này" }),
  ).toBeVisible();
  expect(downloads).toEqual([]);
  expect(
    api
      .requests()
      .filter(
        (r) =>
          r.path ===
          "/enterprise-registration-documents/44444444-4444-4444-8444-444444444444",
      ),
  ).toHaveLength(1);
});
test("review shows nested baseline v2 legal, production and service data without object placeholders", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.profile-data");
  await page.goto(`/admin/enterprises/${id}`);
  await expect(
    page.getByText("12 ha đất canh tác", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Tích hợp hệ thống kiểm thử", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("[object Object]", { exact: true })).toHaveCount(
    0,
  );
});
test("platform overview and inbox retain the baseline aggregate data and canonical deep link", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.workbench");
  await page.goto("/admin");
  await expect(page.getByTestId("ledger-screen-admin")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Tổng quan nền tảng", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Mở hàng đợi →", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/inbox$/);
  await expect(page.getByTestId("ledger-screen-admin-inbox")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Hàng đợi quyết định", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Mở để xử lý", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/enterprises/${id}$`));
  await expect(
    page.getByRole("heading", { name: "HTX Hồ sơ kiểm thử", exact: true }),
  ).toBeVisible();
});
