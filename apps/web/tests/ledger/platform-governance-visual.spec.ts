import path from "node:path";
import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const out = path.resolve(
  __dirname,
  "../../../../.superpowers/sdd/2026-10-22-ledger-ui-migration",
);
test("Ledger governance presentation has no document overflow on desktop and mobile", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  for (const [url, name] of [
    ["/admin/inbox", "inbox"],
    ["/admin/enterprises/11111111-1111-4111-8111-111111111111", "enrollment"],
    ["/admin/approvals/new", "proposal"],
    ["/admin/security", "mfa"],
  ]) {
    await page.goto(url);
    if (name === "proposal")
      await expect(
        page
          .getByRole("dialog")
          .getByRole("heading", { name: "Tạo đề xuất phê duyệt", exact: true }),
      ).toBeVisible();
    else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: path.join(out, `task-6-${name}-desktop.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  await page.goto("/admin/inbox");
  await page
    .getByRole("button", { name: "Giao diện tối", exact: true })
    .click();
  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.screenshot({
    path: path.join(out, "task-6-inbox-dark-en.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "VI", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/enterprises/11111111-1111-4111-8111-111111111111");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "HTX Hồ sơ kiểm thử",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(out, "task-6-enrollment-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Mở điều hướng", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({
    path: path.join(out, "task-6-mobile-navigation.png"),
  });
});
