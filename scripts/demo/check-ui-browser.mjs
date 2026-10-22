// Browser-only contract fixtures: never enabled in the shipped UI or sent to an API.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.UI_TEST_URL ?? "http://localhost:3100";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const output = path.join(tmpdir(), "agritrace-shadcn-ui");
await mkdir(output, { recursive: true });
const orgs = [
  { id: "org-1", name: "Công ty chế biến nông sản An Nhiên", type: "PROCESSOR", status: "ACTIVE" },
  { id: "org-2", name: "Hợp tác xã rau hữu cơ Đồng Xanh", type: "FARM", status: "ACTIVE" },
  { id: "org-3", name: "Xưởng chế biến ngừng hoạt động", type: "PROCESSOR", status: "INACTIVE" },
];
const roles = [{ id: "reader", name: "Chỉ xem", permissions: ["profile.read", "catalog.read"], version: 0 }, { id: "manager", name: "Quản lý nhân sự", permissions: ["profile.read", "members.manage"], version: 0 }];
const members = ["ACTIVE", "LOCKED", "INACTIVE"].map((status, i) => ({ id: `member-${i}`, fullName: ["Nguyễn Minh Anh", "Trần Hoài Nam", "Lê Thu Hà"][i], memberCode: `NV000${i}`, email: `member-${i}@ui.agritrace.test`, phone: "0900000000", accountStatus: status, enterpriseTier: i ? 3 : 1, enterpriseRoles: [{ role: roles[0] }], version: 0 }));
const permissions = ["profile.read", "members.read", "members.manage", "roles.manage", "catalog.read", "processing.read", "processing.write", "reports.read"];
const errors = [], results = [];
const browser = await chromium.launch({ headless: true, channel: process.env.UI_TEST_BROWSER || undefined });
try {
  for (const enterprise of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: "vi-VN", reducedMotion: "reduce" });
    let failOrganizations = false;
    const writes = [];
    const user = { id: "ui-user", fullName: "Nguyễn Minh Anh", email: "test@ui.agritrace.test", organizationId: enterprise ? "org-1" : null, accountStatus: "ACTIVE", role: { code: enterprise ? "PROCESSOR" : "SYSTEM_ADMIN", name: enterprise ? "Nhà chế biến" : "Quản trị hệ thống" } };
    await context.route("**/api/**", async route => {
      const url = new URL(route.request().url()), endpoint = url.pathname.replace(/^\/api/, "");
      let data;
      if (!["GET", "OPTIONS"].includes(route.request().method()) && endpoint !== "/auth/refresh") {
        writes.push({ endpoint, body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
      }
      if (endpoint === "/auth/refresh") data = { accessToken: "isolated-browser-fixture", tokenType: "Bearer", user };
      else if (endpoint === "/chain-permissions") data = { accessRevision: "a".repeat(64), productionChains: [] };
      else if (endpoint === "/enterprise-access") data = { stage: "ACTIVE_LEGACY", owner: true, primary: true, tier: 1, capabilities: ["PROCESSOR"], permissions };
      else if (endpoint === "/organizations") {
        if (failOrganizations) return route.fulfill({ status: 503, json: { success: false, error: { code: "TEST_ERROR", message: "Không tải được tổ chức. Vui lòng thử lại." } } });
        data = orgs;
      } else if (endpoint === "/platform-admin/dashboard") data = { record: {
        generatedAt: new Date().toISOString(), organizations: { capabilities: { PROCESSOR: 2, FARM: 1 }, byModel: { SINGLE: 3 }, byStatus: { INACTIVE: 1 } },
        pending: { total: 0, overdue: 0, ENROLLMENT: 0, CAPABILITY: 0, CONSUMER_REPORT: 0, TICKET: 0, APPROVAL: 0 },
        billing: { active: 2, grace: 0, restricted: 0, expiringSoon: [], monthRevenue: 0, monthSimulated: 0, outstanding: 0 },
        traceability: { lots: 0, processedLots: 0, processingRuns30Days: 0, scans7Days: 0, blockedQr: 0 },
        ledger: { outbox: {}, proofs: {}, unresolvedHolds: 0, lastConfirmedAt: null }, security: { lockedAccounts: 1, adminsWithoutMfa: 0, admins: 1 }, recentActivity: [], notices: []
      } };
      else if (endpoint === "/users") data = members.map(m => ({ ...m, role: user.role, organization: null }));
      else if (endpoint === "/enterprise-workspace/members") data = { items: members };
      else if (endpoint === "/enterprise-workspace/roles") data = { items: roles };
      else if (endpoint === "/enterprise-workspace") data = { permissions, member: { primary: true, tier: 1 }, organization: orgs[0], counts: { members: 3, sites: 0, products: 0, transfers: 0 } };
      else if (endpoint === "/distribution/tasks") data = { transfers: [], stock: [], counts: { total: 0 } };
      else data = { items: [], counts: { unread: 0 } };
      await route.fulfill({ status: 200, json: { success: true, data } });
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const routes = enterprise ? ["/enterprise", "/enterprise/members", "/enterprise/roles", "/enterprise/roles/new", "/enterprise/processing"] : ["/admin", "/admin/organizations", "/admin/users", "/admin/users/new"];
    for (const route of routes) for (const width of [1440, 390, 320, 768]) for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`${base}${route}`);
      await page.locator(".workspace-main h1").waitFor();
      await page.getByRole("button", { name: "Chế độ giao diện" }).click();
      await page.getByRole("menuitemradio", { name: theme === "dark" ? "Tối" : "Sáng", exact: true }).click();
      await page.waitForFunction(t => document.documentElement.classList.contains(t), theme);
      await page.waitForTimeout(100);
      const overflow = await page.evaluate(() => [...document.querySelectorAll("main *")].filter(e => e.getBoundingClientRect().right > innerWidth + 2).slice(0, 8).map(e => ({ tag: e.tagName, className: e.className, right: e.getBoundingClientRect().right })));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, `${route} overflows at ${width}: ${JSON.stringify(overflow)}`);
      assert.equal(await page.locator("main").count(), 1, "One main landmark");
      if (width === 390) {
        await page.getByRole("button", { name: "Đóng/mở điều hướng", exact: true }).click();
        await page.getByRole("dialog").waitFor();
        if (theme === "dark" && route === routes[0]) await page.screenshot({ path: path.join(output, `${enterprise ? "enterprise" : "admin"}-mobile-drawer.png`) });
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
      }
      await page.screenshot({ path: path.join(output, `${route.replaceAll("/", "-")}-${width}-${theme}.png`), fullPage: true });
      results.push({ route, width, theme });
    }
    if (!enterprise) {
      await page.goto(`${base}/admin/organizations`);
      await page.getByLabel("Tìm tổ chức", { exact: true }).fill("không tồn tại");
      await page.getByText("Không tìm thấy tổ chức", { exact: true }).waitFor();
      await page.getByLabel("Xóa từ khóa tìm kiếm").click();
      await page.getByLabel("Lọc loại tổ chức").selectOption("PROCESSOR");
      await page.getByText("2 tổ chức phù hợp").waitFor();
      failOrganizations = true;
      await page.getByRole("button", { name: "Tải lại", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Không tải được tổ chức" }).waitFor();
    }
    if (enterprise) {
      await page.goto(`${base}/enterprise/roles`);
      await page.getByRole("button", { name: "Xóa", exact: true }).last().click();
      await page.getByRole("dialog", { name: "Xác nhận xóa nhóm quyền" }).waitFor();
      await page.screenshot({ path: path.join(output, "confirm-dark.png") });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(writes.length, 0, "Cancel must not send a command");
      await page.goto(`${base}/enterprise/roles/new`);
      await page.getByLabel(/Tên nhóm quyền/).fill("Nhóm kiểm thử trình duyệt");
      await page.getByRole("button", { name: "Tạo nhóm quyền", exact: true }).click();
      await page.getByRole("dialog", { name: "Xác nhận thao tác" }).getByRole("button", { name: "Xác nhận", exact: true }).click();
      await page.waitForURL(`${base}/enterprise/roles`);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].body.name, "Nhóm kiểm thử trình duyệt");
      assert.equal(writes[0].endpoint, "/enterprise-workspace/roles");
      assert.match(writes[0].key, /^[0-9a-f-]{36}$/);
      await page.getByText("Đã lưu thay đổi", { exact: true }).waitFor();
    }
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.getItem("agritrace:color-mode")), "dark");
    await page.getByRole("button", { name: "Chế độ giao diện" }).click();
    await page.getByRole("menuitemradio", { name: "Hệ thống", exact: true }).click();
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      await page.waitForFunction(theme => document.documentElement.classList.contains(theme), colorScheme);
    }
    await page.reload();
    assert.equal(await page.evaluate(() => localStorage.getItem("agritrace:color-mode")), "system");
    await context.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "results.json"), JSON.stringify({ results, errors }, null, 2));
  console.log(`${results.length} route/viewport/theme checks passed. Screenshots: ${output}`);
} finally { await browser.close(); }
