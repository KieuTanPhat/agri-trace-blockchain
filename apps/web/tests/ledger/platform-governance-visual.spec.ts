import path from "node:path";
import { test, expect } from "./fixtures";
import "./fixtures/platform-governance";
const out = path.resolve(
  __dirname,
  "../../../../.superpowers/sdd/2026-10-22-ledger-ui-migration",
);

test("Ledger focus trap, Escape and small viewports work with reduced motion",async({page,api})=>{
 await page.emulateMedia({reducedMotion:"reduce"});await api.useActor("platform-admin");await api.scenario("governance.registry");
 await page.setViewportSize({width:320,height:844});await page.goto("/admin/inbox");
 await expect(page.getByRole("heading",{level:1})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 const trigger=page.getByRole("button",{name:"Mở điều hướng",exact:true});await trigger.focus();await page.keyboard.press("Enter");
 const dialog=page.getByRole("dialog");await expect(dialog).toBeVisible();
 for(let i=0;i<4;i++){await page.keyboard.press(i%2?"Shift+Tab":"Tab");expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
 await page.keyboard.press("Escape");await expect(dialog).toHaveCount(0);await expect(trigger).toBeFocused();
 expect(await page.evaluate(()=>matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
});

test("Ledger login fits desktop and phone",async({page,api})=>{
 await api.useActor("anonymous");await page.goto("/login");
 await expect(page.getByLabel("Email",{exact:true})).toBeEnabled();await page.evaluate(()=>document.fonts.ready);
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await expect(page.getByRole("heading",{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(out,`task-18-login-${width}.png`),animations:"disabled"});}
});
test("Ledger governance presentation has no document overflow on desktop and mobile", async ({
  page,
  api,
}) => {
  await api.useActor("platform-admin");
  await api.scenario("governance.registry");
  for (const [url, name] of [
    ["/admin/inbox", "inbox"],
    ["/admin/enterprises/11111111-1111-4111-8111-111111111111", "enrollment"],
    ["/admin/security", "mfa"],
  ]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
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
