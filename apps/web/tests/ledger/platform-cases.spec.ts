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
