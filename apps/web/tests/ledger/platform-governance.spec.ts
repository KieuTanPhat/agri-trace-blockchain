import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const id = "11111111-1111-4111-8111-111111111111";
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
test("maker cannot approve own proposal", async ({ page, api }) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.own-proposal");
  await page.goto(`/admin/approvals/${id}`);
  await expect(
    page.getByTestId("ledger-screen-admin-approvals-detail"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Phê duyệt đề xuất", exact: true }),
  ).toBeDisabled();
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && r.path.includes("/decision")),
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
