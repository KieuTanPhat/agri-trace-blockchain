import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
const local = new URL("../../.codex/seed-current/", import.meta.url);
const accounts = JSON.parse(
  await readFile(new URL("accounts.json", local), "utf8"),
);
const dataset = JSON.parse(
  await readFile(new URL("dataset.json", local), "utf8"),
);
const browser = await chromium.launch({ headless: true });
const results = [],
  errors = [];
try {
  async function context(email) {
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: "vi-VN",
      }),
      page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const account = accounts.users.find((x) => x.email === email);
    assert.ok(account);
    await page.goto("http://localhost:3000/login");
    await page.locator('input[type="email"]').fill(account.email);
    await page.locator('input[type="password"]').fill(account.password);
    await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
    await page.waitForURL((url) => !url.pathname.includes("/login"), {
      timeout: 25000,
    });
    return { context, page };
  }
  async function inspect(page, path, label, width = 1440) {
    await page.setViewportSize({ width, height: 1000 });
    const response = await page.goto(`http://localhost:3000${path}`);
    assert.equal(response.status(), 200);
    await page.waitForLoadState("networkidle");
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.8) {
        scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");
    const title = await page.locator("h1").first().textContent();
    assert.ok(title?.trim(), `Missing title ${path}`);
    const text = await page.locator("body").innerText();
    assert.ok(!text.includes("Application error: a client-side exception"));
    const broken = await page
      .locator("img")
      .evaluateAll((images) =>
        images
          .filter((x) => x.complete && x.naturalWidth === 0)
          .map((x) => x.getAttribute("src")),
      );
    assert.equal(broken.length, 0, `Broken image on ${path}`);
    if (path.startsWith("/trace/")) {
      const photo = page.locator(".trace-product-photo");
      assert.ok((await photo.getAttribute("src"))?.includes("/evidence/"));
      assert.ok(await photo.evaluate((image) => image.naturalWidth >= 500));
    }
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 2,
    );
    assert.equal(overflow, false, `Page overflows ${width}px: ${path}`);
    await page.screenshot({
      path: new URL(`${label}-${width}.png`, local).pathname.replace(
        /^\/([A-Z]:)/,
        "$1",
      ),
      fullPage: true,
    });
    results.push({
      path,
      width,
      title,
      images: await page.locator("img").count(),
    });
    console.log(`PASS browser ${width}px ${path}`);
  }
  const farm = await context("farm.owner@example.test");
  for (const [path, label] of [
    ["/enterprise/profile", "profile"],
    ["/enterprise/members", "members"],
    ["/enterprise/products", "products"],
    ["/production-cycles", "cycles"],
    ["/distribution", "distribution"],
  ])
    await inspect(farm.page, path, label);
  const cycle = dataset.production.cycles.find((x) => x.key === "farm");
  await inspect(farm.page, `/production-cycles/${cycle.id}`, "cycle", 390);
  await farm.context.close();
  const admin = await context("admin@example.test");
  for (const [path, label] of [
    ["/admin/enterprises", "admin-enterprises"],
    ["/admin/users", "admin-users"],
    ["/admin/support", "admin-support"],
  ])
    await inspect(admin.page, path, label);
  await admin.context.close();
  const processor = await context("processor.owner@example.test");
  await inspect(processor.page, "/enterprise/processing", "processing");
  await processor.context.close();
  const publicContext = await browser.newContext(),
    page = await publicContext.newPage();
  for (const width of [320, 390, 768, 1440])
    await inspect(
      page,
      `/trace/${dataset.production.lots[0].traceToken}`,
      "trace",
      width,
    );
  const processed = JSON.parse(await readFile(new URL("processed-traces.json", local), "utf8"));
  await inspect(page, `/trace/${processed[0].traceToken}`, "processed-trace", 390);
  await publicContext.close();
  assert.equal(errors.length, 0, `Client exceptions: ${errors.join("; ")}`);
  await writeFile(
    new URL("browser-receipt.json", local),
    JSON.stringify(
      {
        completedAt: new Date().toISOString(),
        results,
        clientExceptions: errors,
      },
      null,
      2,
    ),
  );
  console.log(`Browser checks passed: ${results.length} pages/viewports.`);
} finally {
  await browser.close();
}
