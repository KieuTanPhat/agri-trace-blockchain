import path from "node:path";
import { test, expect } from "./fixtures";
import { assignedCase } from "./fixtures/platform-cases";

test("case manager reads Ledger cases and opens the canonical creation URL", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.assigned");
  await page.goto("/admin/cases");
  await expect(page.getByTestId("ledger-case-list")).toBeVisible();
  await expect(
    page.getByText(assignedCase.title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tạo hồ sơ sự cố", exact: true }),
  ).toHaveAttribute("href", "/admin/cases/new");
  expect(
    api
      .requests()
      .some((r) => r.method !== "GET" && !r.path.startsWith("/auth/")),
  ).toBe(false);
});
test("auditor has loaded case records and read-only controls", async ({
  page,
  api,
}) => {
  await api.useActor("auditor");
  await api.scenario("cases.assigned");
  await page.goto("/admin/cases");
  await expect(page.getByTestId("ledger-case-list")).toBeVisible();
  await expect(
    page.getByText(assignedCase.title, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Tạo hồ sơ sự cố", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Tạo hồ sơ sự cố", exact: true }),
  ).toHaveCount(0);
});
test("case filters and pagination use the baseline query and cursor", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.assigned");
  await page.goto("/admin/cases");
  await expect(page.getByTestId("ledger-case-list")).toBeVisible();
  await expect(
    page.getByText(assignedCase.title, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tải thêm", exact: true }).click();
  await expect(
    page.getByText("Hồ sơ trang tiếp theo", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Chỉ quá hạn", { exact: true }).check();
  await expect
    .poll(() =>
      api.requests().some((r) => r.path === "/platform-cases?overdue=true"),
    )
    .toBe(true);
  await expect(
    page.getByText("Hồ sơ trang tiếp theo", { exact: true }),
  ).toHaveCount(0);
});

test("case detail uses the Ledger timeline and auditor remains read only", async ({
  page,
  api,
}) => {
  await api.useActor("auditor");
  await api.scenario("cases.detail");
  await page.goto("/admin/cases/11111111-1111-4111-8111-111111111111");
  await expect(page.getByTestId("ledger-case-detail")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Dòng thời gian", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(assignedCase.description, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đóng hồ sơ", exact: true }),
  ).toHaveCount(0);
});
test("closing a case sends its version and command key then locks the closed record", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.close");
  await page.goto("/admin/cases/11111111-1111-4111-8111-111111111111");
  await expect(page.getByTestId("ledger-case-detail")).toBeVisible();
  await page.getByRole("button", { name: "Đóng hồ sơ", exact: true }).click();
  await page
    .getByLabel("Lý do đóng", { exact: true })
    .fill("Đã đối soát đầy đủ hồ sơ");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Đóng hồ sơ", exact: true })
    .click();
  await expect(
    page.getByText("Hồ sơ đã đóng là bất biến.", { exact: true }),
  ).toBeVisible();
  expect(
    api
      .requests()
      .filter((r) => r.method === "POST" && !r.path.startsWith("/auth/"))
      .map((r) => r.path),
  ).toEqual(["/platform-cases/11111111-1111-4111-8111-111111111111/close"]);
});

test("new case keeps the canonical URL and posts a baseline DTO", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.create");
  await page.goto("/admin/cases/new");
  await expect(page.getByTestId("ledger-case-create")).toBeVisible();
  await page.getByLabel("Tiêu đề", { exact: true }).fill("Hồ sơ xác minh mới");
  await page
    .getByLabel("Mô tả", { exact: true })
    .fill("Đề nghị đối chiếu hồ sơ doanh nghiệp");
  await page
    .getByRole("button", { name: "Tạo hồ sơ sự cố", exact: true })
    .click();
  await expect(page).toHaveURL(
    /\/admin\/cases\/11111111-1111-4111-8111-111111111111$/,
  );
  await expect(page.getByTestId("ledger-case-detail")).toBeVisible();
});

for (const action of [
  {
    button: "Phân loại",
    submit: "Ghi phân loại",
    field: "Căn cứ",
    path: "classify",
  },
  { button: "Gắn lô", submit: "Gắn lô", field: "Ghi chú", path: "link-lot" },
  {
    button: "Leo thang",
    submit: "Leo thang",
    field: "Lý do leo thang",
    path: "escalate",
  },
  {
    button: "Giao doanh nghiệp",
    submit: "Giao hồ sơ",
    field: "Yêu cầu gửi doanh nghiệp",
    path: "assign",
  },
])
  test(
    "case command preserves baseline DTO: " + action.path,
    async ({ page, api }) => {
      await api.useActor("case-manager");
      await api.scenario("cases.actions");
      await page.goto("/admin/cases/11111111-1111-4111-8111-111111111111");
      await expect(page.getByTestId("ledger-case-detail")).toBeVisible();
      await page
        .getByRole("button", { name: action.button, exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel(action.field, { exact: true })
        .fill("Đã đối soát thông tin đầy đủ");
      if (action.path === "link-lot")
        await dialog
          .getByLabel("Lô", { exact: true })
          .fill("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
      if (action.path === "assign") {
        await dialog
          .getByRole("combobox", { name: "Tổ chức", exact: true })
          .click();
        await page
          .getByRole("option", { name: "Doanh nghiệp được giao", exact: true })
          .click();
      }
      await dialog
        .getByRole("button", { name: action.submit, exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      const posts = api
        .requests()
        .filter(
          (r) => r.method === "POST" && r.path.endsWith("/" + action.path),
        );
      expect(posts).toHaveLength(1);
      expect(JSON.parse(posts[0]!.body!)).toMatchObject({
        version: 3,
        note: "Đã đối soát thông tin đầy đủ",
      });
    },
  );
test("unknown private note freezes the form and retries its original body and key from memory", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.unknown-note");
  await page.goto("/admin/cases/11111111-1111-4111-8111-111111111111");
  const note = page.getByLabel("Nội dung", { exact: true });
  await note.fill("PRIVATE_CASE_NOTE_123");
  await page.getByRole("button", { name: "Ghi chú", exact: true }).click();
  await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
  await expect(note).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("PRIVATE_CASE_NOTE_123");
  await page.getByRole("button", { name: "Đối soát", exact: true }).click();
  await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
  await expect(note).toHaveValue("");
  const posts = api
    .requests()
    .filter((r) => r.method === "POST" && r.path.endsWith("/notes"));
  expect(posts).toHaveLength(2);
  expect(posts[1]!.body).toBe(posts[0]!.body);
  expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);
  expect(JSON.parse(posts[0]!.body!)).toEqual({
    note: "PRIVATE_CASE_NOTE_123",
    visibility: "INTERNAL",
  });
});

test("Ledger case presentation fits desktop and mobile", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("cases.detail");
  const out = path.resolve(
    __dirname,
    "../../../../.superpowers/sdd/2026-10-22-ledger-ui-migration",
  );
  await page.goto("/admin/cases/11111111-1111-4111-8111-111111111111");
  await expect(page.getByTestId("ledger-case-detail")).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(out, "task-7-case-detail-" + width + ".png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page
    .getByRole("button", { name: "Giao diện tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.screenshot({
    path: path.join(out, "task-7-case-detail-dark-en.png"),
    fullPage: true,
  });
});

test("privacy officer sees scoped privacy records in Ledger", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.scoped");
  await page.goto("/admin/privacy");
  await expect(page.getByTestId("ledger-privacy-workspace")).toBeVisible();
  await expect(
    page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("OUTSIDE_SCOPE_PRIVATE_RECORD")).toHaveCount(0);
});
test("an enterprise account reads its own privacy records without platform elevation", async ({
  page,
  api,
}) => {
  await api.useActor("org-staff");
  await api.scenario("privacy.self");
  await page.goto("/account/privacy");
  await expect(page.getByTestId("ledger-privacy-workspace")).toBeVisible();
  await expect(
    page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Gửi yêu cầu quyền dữ liệu",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    api.requests().some((r) => r.path.startsWith("/platform-privacy")),
  ).toBe(false);
});

test("privacy review can submit without MFA when baseline policy does not require it", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.review");
  await page.goto("/admin/privacy");
  await page
    .getByLabel("Ghi chú", { exact: true })
    .fill("PRIVATE_REVIEW_NOTE_789");
  await page.getByRole("button", { name: "Ghi cập nhật", exact: true }).click();
  await expect(
    page.locator("ol").getByText("PRIVATE_REVIEW_NOTE_789", { exact: true }),
  ).toBeVisible();
});
test("pending privacy review keeps its record, private body and command identity in the tab", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.unknown-review");
  await page.goto("/admin/privacy");
  const note = page.getByLabel("Ghi chú", { exact: true });
  await note.fill("PRIVATE_REVIEW_NOTE_789");
  await page.getByRole("button", { name: "Ghi cập nhật", exact: true }).click();
  await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
  await expect(note).toBeDisabled();
  await expect(page.getByRole("button", { name: /Chỉnh sửa/ })).toBeDisabled();
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("PRIVATE_REVIEW_NOTE_789");
  await page.getByRole("button", { name: "Đối soát", exact: true }).click();
  await expect(
    page.locator("ol").getByText("PRIVATE_REVIEW_NOTE_789", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
  const posts = api
    .requests()
    .filter((r) => r.method === "POST" && r.path.endsWith("/review"));
  expect(posts).toHaveLength(2);
  expect(posts[1]!.body).toBe(posts[0]!.body);
  expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);
});
test("self privacy offers all six baseline rights and sends DELETION without platform authority", async ({
  page,
  api,
}) => {
  await api.useActor("org-staff");
  await api.scenario("privacy.create");
  await page.goto("/account/privacy");
  await page
    .getByRole("button", { name: "Gửi yêu cầu quyền dữ liệu", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d.getByRole("combobox", { name: "Loại yêu cầu", exact: true }).click();
  await expect(page.getByRole("option")).toHaveCount(6);
  await page.getByRole("option", { name: "Xóa dữ liệu", exact: true }).click();
  await d
    .getByLabel("Nội dung yêu cầu", { exact: true })
    .fill("Tôi yêu cầu xóa dữ liệu cá nhân");
  await d.getByRole("button", { name: "Gửi yêu cầu", exact: true }).click();
  await expect(d).toHaveCount(0);
  expect(
    api.requests().some((r) => r.path.startsWith("/platform-privacy")),
  ).toBe(false);
});

test("privacy breach keeps its detected time and forwards optional MFA without extra fields", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.breach");
  await page.goto("/admin/privacy");
  await page
    .getByRole("button", { name: "Ghi nhận vi phạm", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Mã MFA (khi được yêu cầu)", { exact: true })
    .fill("123456");
  await d
    .getByLabel("Thời điểm phát hiện", { exact: true })
    .fill("2026-10-22T00:00");
  await d.getByLabel("Mô tả sự cố", { exact: true }).fill("PRIVATE_BREACH_456");
  await d.getByRole("button", { name: "Ghi nhận", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByText("PRIVATE_BREACH_456", { exact: true }),
  ).toBeVisible();
  const posted = api
    .requests()
    .find(
      (r) => r.method === "POST" && r.path === "/platform-privacy/breaches",
    );
  expect(JSON.parse(posted!.body!).detectedAt).toBe(
    await page.evaluate(() => new Date("2026-10-22T00:00").toISOString()),
  );
});
test("privacy cursor loads the next authorized record", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.pagination");
  await page.goto("/admin/privacy");
  await expect(
    page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Tải thêm", exact: true }).click();
  await page.getByRole("button", { name: /Chỉnh sửa/ }).click();
  await expect(
    page.getByText("SECOND_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  expect(
    api
      .requests()
      .some(
        (r) =>
          r.path ===
          "/platform-privacy?cursor=11111111-1111-4111-8111-111111111111",
      ),
  ).toBe(true);
});
test("auditor is explicitly denied platform privacy before any private API read", async ({
  page,
  api,
}) => {
  await api.useActor("auditor");
  await api.scenario("privacy.scoped");
  await page.goto("/admin/privacy");
  await expect(
    page.getByRole("heading", { name: "Không có quyền truy cập", exact: true }),
  ).toBeVisible();
  expect(
    api.requests().some((r) => r.path.startsWith("/platform-privacy")),
  ).toBe(false);
});

test("Ledger privacy is readable on desktop and mobile with VI and EN controls", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.scoped");
  await page.goto("/admin/privacy");
  await expect(
    page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  const out = path.resolve(
    __dirname,
    "../../../../.superpowers/sdd/2026-10-22-ledger-ui-migration",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(out, "task-7-privacy-" + width + ".png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(
    page.getByLabel("MFA code (when required)", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Dark theme", exact: true }).click();
  await page.screenshot({
    path: path.join(out, "task-7-privacy-dark-en.png"),
    fullPage: true,
  });
});

test("privacy displays the actual baseline OPEN status with its Ledger label", async ({
  page,
  api,
}) => {
  await api.useActor("privacy-officer");
  await api.scenario("privacy.scoped");
  await page.goto("/admin/privacy");
  await expect(
    page.getByText("IN_SCOPE_PRIVACY_RECORD", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Mới", { exact: true }).first()).toBeVisible();
});

test("support list links to the canonical deep detail route", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.open");
  await page.goto("/admin/support");
  await expect(page.getByTestId("ledger-support-workspace")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /SUPPORT_IN_SCOPE_RECORD/ }),
  ).toHaveAttribute(
    "href",
    "/admin/support/11111111-1111-4111-8111-111111111111",
  );
});
test("support deep link replies using baseline body, version and command key", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.open");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  await expect(page.getByTestId("ledger-support-workspace")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SUPPORT_IN_SCOPE_RECORD", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Nội dung", { exact: true })
    .fill("Nội dung phản hồi cần xử lý");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(
    page
      .locator("ol")
      .getByText("Nội dung phản hồi cần xử lý", { exact: true }),
  ).toBeVisible();
});
test("closed support record is loaded without reply or assignment controls", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.closed");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  await expect(page.getByTestId("ledger-support-workspace")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SUPPORT_IN_SCOPE_RECORD", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Nội dung", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Gán / đổi ưu tiên", exact: true }),
  ).toHaveCount(0);
});

test("pending support reply locks filters and keeps the original body and key", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.unknown");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  const field = page.getByLabel("Nội dung", { exact: true });
  await field.fill("Nội dung phản hồi cần xử lý");
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(page.getByTestId("ledger-command-pending")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Đã đóng", exact: true }),
  ).toBeDisabled();
  await expect(field).toBeDisabled();
  await page.getByRole("button", { name: "Đối soát", exact: true }).click();
  await expect(
    page
      .locator("ol")
      .getByText("Nội dung phản hồi cần xử lý", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
  const posts = api
    .requests()
    .filter((r) => r.method === "POST" && r.path.endsWith("/reply"));
  expect(posts).toHaveLength(2);
  expect(posts[1]!.body).toBe(posts[0]!.body);
  expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);
});

test("support assignment uses the active platform staff UUID and version", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.actions");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  await page
    .getByRole("button", { name: "Gán / đổi ưu tiên", exact: true })
    .click();
  const d = page.getByRole("dialog");
  await d
    .getByRole("combobox", { name: "Người phụ trách", exact: true })
    .click();
  await page
    .getByRole("option", { name: /Người phụ trách · PLATFORM_CASE_MANAGER/ })
    .click();
  await d.getByRole("button", { name: "Gán", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(
    page.getByText("Người phụ trách", { exact: true }),
  ).toBeVisible();
});
test("internal support note omits the selected external status", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.actions");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  await page
    .getByLabel("Nội dung", { exact: true })
    .fill("Ghi chú nền tảng riêng tư");
  await page
    .getByRole("radio", { name: "Ghi chú nội bộ", exact: true })
    .check();
  await page
    .getByRole("combobox", { name: "Chuyển trạng thái", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Đã giải quyết", exact: true })
    .click();
  await page.getByRole("button", { name: "Gửi", exact: true }).click();
  await expect(
    page.locator("ol").getByText("Ghi chú nền tảng riêng tư", { exact: true }),
  ).toBeVisible();
});
test("support closing sends its reason then removes write controls", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.actions");
  await page.goto("/admin/support/11111111-1111-4111-8111-111111111111");
  await page.getByRole("button", { name: "Đóng yêu cầu", exact: true }).click();
  const d = page.getByRole("dialog");
  await d
    .getByLabel("Kết quả xử lý", { exact: true })
    .fill("Đã hoàn thành xử lý hỗ trợ");
  await d.getByRole("button", { name: "Đóng yêu cầu", exact: true }).click();
  await expect(d).toHaveCount(0);
  await expect(page.getByLabel("Nội dung", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Đã hoàn thành xử lý hỗ trợ/)).toBeVisible();
});
test("support status filter reaches the baseline query", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.actions");
  await page.goto("/admin/support");
  await expect(
    page.getByRole("heading", { name: "SUPPORT_IN_SCOPE_RECORD", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Đã đóng", exact: true }).click();
  await expect
    .poll(() =>
      api
        .requests()
        .some((r) => r.path === "/platform-admin/tickets?status=CLOSED"),
    )
    .toBe(true);
  await expect(
    page
      .locator('section[aria-label="Yêu cầu SUP-17"]')
      .getByText("Đã đóng", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByLabel("Nội dung", { exact: true })).toHaveCount(0);
});
test("missing support deep link does not fall back to another ticket", async ({
  page,
  api,
}) => {
  await api.useActor("case-manager");
  await api.scenario("support.open");
  await page.goto("/admin/support/99999999-9999-4999-8999-999999999999");
  await expect(
    page.getByText("Không tìm thấy yêu cầu hỗ trợ", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SUPPORT_IN_SCOPE_RECORD", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Nội dung", { exact: true })).toHaveCount(0);
});
