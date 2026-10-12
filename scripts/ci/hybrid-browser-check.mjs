import assert from "node:assert/strict";
import { chromium, devices } from "playwright";
import { PrismaPg } from "@prisma/adapter-pg";
import { hash } from "bcrypt";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client.ts";
import { checkPartyConsent } from "./hybrid-browser-consent.mjs";

assert.equal(process.env.HYBRID_BROWSER_TESTS, "1");
assert.match(process.env.DATABASE_URL, /@127\.0\.0\.1:25489\/browser_test$/);
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});
const origin = "http://127.0.0.1:25600";
const control = process.env.HYBRID_BROWSER_CONTROL;
const prefix = "agritrace-command:v1:";
const password = "Isolated-browser-fixture-2026!";
const cases = [];
const browser = await chromium.launch({ headless: true });
let lastPage;
let ownerChainName;
const browserEvents = [];
async function until(work, label, timeout = 20000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await work();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Browser condition failed: ${label}; ${last instanceof Error ? last.message : ""}`,
  );
}
async function login(page, user, canCreate = true) {
  await page.goto(origin + "/login?next=/supply-chains");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await page.waitForURL("**/supply-chains");
  await page
    .getByRole("combobox", { name: /^Chọn chuỗi/ })
    .waitFor({ state: "visible" });
  if (canCreate)
    await page.getByLabel(/^Tên chuỗi/).waitFor({ state: "visible" });
}
async function ledger(page) {
  return page.evaluate(
    (prefix) =>
      Object.fromEntries(
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, value]) => [key, JSON.parse(value)]),
      ),
    prefix,
  );
}
async function pending(page) {
  return Object.values(await ledger(page))
    .flatMap((item) => Object.values(item.entries))
    .filter((entry) => entry.status === "PENDING");
}
async function create(page, name) {
  await page.getByLabel(/^Tên chuỗi/).fill(name);
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel(/^Tên chuỗi/) });
  await form
    .getByRole("button", { name: "Tạo chuỗi cung ứng", exact: true })
    .click();
}
try {
  const users = [];
  for (const [name, type, code] of [
    ["Owner", "FARM", "FARM_STAFF"],
    ["Other", "FARM", "FARM_STAFF"],
    ["Transport", "TRANSPORTER", "TRANSPORTER"],
    ["Retail", "RETAILER", "RETAILER"],
  ]) {
    const role = await db.role.upsert({
      where: { code },
      update: {},
      create: { code, name: code },
    });
    const org = await db.organization.create({
      data: { name: `Browser ${name} ${randomUUID()}`, type },
    });
    const user = await db.user.create({
      data: {
        email: `${randomUUID()}@example.test`,
        fullName: `Browser ${name}`,
        passwordHash: await hash(password, 10),
        roleId: role.id,
        organizationId: org.id,
      },
    });
    for (const role of type === "FARM"
      ? ["ORG_ADMIN", "CREATE_CHAIN"]
      : ["ORG_ADMIN"])
      await db.scopedRoleGrant.create({
        data: {
          scope: "ORGANIZATION",
          role,
          organizationId: org.id,
          userId: user.id,
        },
      });
    users.push(user);
  }
  const [owner, other, transport, retail] = users;
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
  });
  let blockInspection = true;
  let lost = true;
  let writes = 0;
  let original;
  await context.route("**/api/command-requests/status", async (route) =>
    blockInspection ? route.abort("failed") : route.continue(),
  );
  await context.route("**/api/supply-chains", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    original = {
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    };
    if (!lost) return route.continue();
    lost = false;
    const reply = await route.fetch();
    assert.equal(
      reply.status(),
      201,
      "the real API must commit before response loss",
    );
    await reply.dispose();
    await route.abort("failed");
  });
  const page = (lastPage = await context.newPage());
  context.on("page", (item) =>
    item.on("framenavigated", (frame) => {
      if (frame === item.mainFrame())
        browserEvents.push({
          time: Date.now(),
          kind: "navigation",
          url: frame.url(),
        });
    }),
  );
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      browserEvents.push({
        time: Date.now(),
        kind: "navigation",
        url: frame.url(),
      });
  });
  context.on("response", (response) => {
    if (response.url().includes("/api/"))
      browserEvents.push({
        time: Date.now(),
        kind: "response",
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      });
  });
  await login(page, owner);
  const name = `Recovered browser chain ${randomUUID()}`;
  ownerChainName = name;
  await create(page, name);
  const queue = page.getByRole("region", { name: "Yêu cầu cần đối soát" });
  await queue.waitFor({ state: "visible" });
  await until(
    async () => (await db.supplyChain.count({ where: { name } })) === 1,
    "real chain commit",
  );
  const saved = await pending(page);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].key, original.key);
  assert.deepEqual(saved[0].body, JSON.stringify(original.body));
  assert.equal(
    await queue.innerText().then((text) => text.includes(name)),
    false,
    "queue must not disclose private body",
  );
  await page.reload();
  await queue.waitFor({ state: "visible" });
  assert.equal((await pending(page))[0].key, original.key);
  const second = (lastPage = await context.newPage());
  await second.goto(origin + "/supply-chains");
  const queue2 = second.getByRole("region", { name: "Yêu cầu cần đối soát" });
  await queue2.waitFor({ state: "visible" });
  blockInspection = false;
  await Promise.allSettled([
    queue.getByRole("button", { name: "Kiểm tra và thử lại" }).click(),
    queue2.getByRole("button", { name: "Kiểm tra và thử lại" }).click(),
  ]);
  await until(
    async () => (await pending(page)).length === 0,
    "shared terminal ledger",
  );
  assert.equal(writes, 1, "two tabs must reconcile without another write");
  assert.equal(await db.supplyChain.count({ where: { name } }), 1);
  const record = await db.idempotencyRecord.findUniqueOrThrow({
    where: {
      requesterId_operation_idempotencyKey: {
        requesterId: owner.id,
        operation: "HYB_CREATE_CHAIN",
        idempotencyKey: original.key,
      },
    },
    include: { commandCommit: true },
  });
  assert(record.commandCommit);
  const terminal = Object.values(await ledger(page)).flatMap((item) =>
    Object.values(item.entries),
  );
  assert(
    terminal.every(
      (entry) => entry.body === undefined && entry.result === undefined,
    ),
  );
  cases.push(
    "desktop-real-commit-lost-response-reload-remount-two-tabs-original-key-one-journal",
  );
  await second.close();
  lastPage = page;
  await page.reload();
  await page
    .getByRole("combobox", { name: /^Chọn chuỗi/ })
    .selectOption({ label: name });
  const profile = page.getByRole("region", {
    name: "Trạng thái nghiệp vụ chuỗi",
  });
  await profile.getByText("Đang chuẩn bị", { exact: true }).waitFor();
  const chain = await db.supplyChain.findFirstOrThrow({ where: { name } });
  const activation = page.waitForResponse(
    (reply) =>
      reply.request().method() === "POST" &&
      reply
        .url()
        .endsWith(`/supply-chains/${chain.id}/business-profile/activate`),
  );
  await profile
    .getByRole("button", { name: "Kích hoạt nghiệp vụ chuỗi", exact: true })
    .click();
  assert.equal((await activation).status(), 201);
  await until(
    async () =>
      (
        await db.chainBusinessProfile.findUniqueOrThrow({
          where: { chainId: chain.id },
        })
      ).state === "ACTIVE",
    "activation committed",
  );
  // Activation changes the access revision. Private workspaces deliberately
  // discard their selection, so select again after obtaining current rights.
  await page.reload();
  await page
    .getByRole("combobox", { name: /^Chọn chuỗi/ })
    .selectOption(chain.id);
  await profile.getByText("Đang hoạt động", { exact: true }).waitFor();
  assert.equal(
    (
      await db.chainBusinessProfile.findUniqueOrThrow({
        where: { chainId: chain.id },
      })
    ).state,
    "ACTIVE",
  );
  cases.push("desktop-current-owner-real-activation");
  await page.screenshot({
    path: control + "/desktop-activation.png",
    fullPage: true,
  });
  await checkPartyConsent({
    db,
    page,
    browser,
    owner,
    transport,
    retail,
    chain,
    login,
    until,
    cases,
    control,
    setLastPage: (target) => {
      lastPage = target;
    },
  });

  const mobile = await browser.newContext({ ...devices["iPhone 13"] });
  const phone = (lastPage = await mobile.newPage());
  await login(phone, owner);
  await phone
    .getByRole("combobox", { name: /^Chọn chuỗi/ })
    .selectOption(chain.id);
  await phone.getByText("Đang hoạt động", { exact: true }).waitFor();
  await phone
    .getByRole("button", { name: "Mời đối tác", exact: true })
    .waitFor({ state: "visible" });
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false, "mobile workspace must fit its viewport");
  const grant = await db.scopedRoleGrant.findFirstOrThrow({
    where: {
      chainId: chain.id,
      userId: owner.id,
      role: "CHAIN_MANAGER",
      revokedAt: null,
    },
  });
  await db.scopedRoleGrant.update({
    where: { id: grant.id },
    data: { revokedAt: new Date(), revision: { increment: 1 } },
  });
  const refreshedPermissions = phone.waitForResponse(
    (reply) =>
      reply.url().endsWith("/api/chain-permissions") &&
      reply.request().method() === "GET",
  );
  await phone
    .getByRole("button", { name: "Tải lại quyền và dữ liệu", exact: true })
    .click();
  const permissionReply = await refreshedPermissions;
  assert.equal(permissionReply.status(), 200);
  const permissionBody = await permissionReply.json();
  assert(
    !JSON.stringify(permissionBody).includes(grant.id),
    "revoked grant must be absent in current server permissions",
  );
  // The new access revision remounts the private workspace and intentionally
  // clears selection. Reload and wait for the fresh context, then select.
  await phone.reload();
  await phone.getByLabel(/^Tên chuỗi/).waitFor({ state: "visible" });
  await phone
    .getByText("Đang tải chuỗi được cấp quyền…", { exact: true })
    .waitFor({ state: "hidden" });
  await phone
    .getByRole("combobox", { name: /^Chọn chuỗi/ })
    .selectOption(chain.id);
  await phone
    .getByRole("region", { name: "Trạng thái nghiệp vụ chuỗi" })
    .getByText("Đang hoạt động", { exact: true })
    .waitFor();
  await phone
    .getByText("Đang tải chuỗi được cấp quyền…", { exact: true })
    .waitFor({ state: "hidden" });
  await until(
    async () =>
      !(await phone
        .getByRole("button", { name: "Mời đối tác", exact: true })
        .isVisible()),
    "mobile revoked manager actions disappear",
  );
  await phone.screenshot({
    path: control + "/mobile-revoked.png",
    fullPage: true,
  });
  cases.push("mobile-real-session-profile-and-revoked-manager");
  await mobile.close();

  lastPage = page;
  let unknownRecord;
  await context.unroute("**/api/supply-chains");
  const unknownName = `Unknown browser chain ${randomUUID()}`;
  await context.route("**/api/supply-chains", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const key = route.request().headers()["idempotency-key"];
    const body = route.request().postDataJSON();
    const { canonicalSha256 } =
      await import("../../apps/api/dist/common/crypto/rfc8785.js");
    unknownRecord = await db.idempotencyRecord.create({
      data: {
        requesterId: owner.id,
        operation: "HYB_CREATE_CHAIN",
        requestType: "COMMAND",
        idempotencyKey: key,
        requestHash: canonicalSha256(body),
        authorizationScope: "0".repeat(64),
        status: "PROCESSING",
        createdAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await route.abort("failed");
  });
  await page.reload();
  await page.getByLabel(/^Tên chuỗi/).waitFor();
  await create(page, unknownName);
  await queue.waitFor({ state: "visible" });
  await page.reload();
  await queue.getByRole("button", { name: "Kiểm tra và thử lại" }).click();
  await queue.getByRole("alert").waitFor();
  assert.equal(await db.supplyChain.count({ where: { name: unknownName } }), 0);
  assert.equal(
    await db.commandCommit.count({
      where: { idempotencyRecordId: unknownRecord.id },
    }),
    0,
  );
  assert.deepEqual(
    await db.idempotencyRecord.findUnique({ where: { id: unknownRecord.id } }),
    unknownRecord,
  );
  assert.equal((await pending(page))[0].key, unknownRecord.idempotencyKey);
  assert.equal(writes, 2, "unknown retry must never send another domain write");
  cases.push(
    "expired-unknown-processing-reload-hold-without-execute-or-key-change",
  );
  await page.getByRole("button", { name: "Đăng xuất", exact: true }).click();
  await login(page, other);
  assert.equal(
    await queue.isVisible(),
    false,
    "other account must not see or replay original owner queue",
  );
  assert(!(await page.content()).includes(unknownName));
  cases.push("account-switch-private-pending-queue-isolation");
  await context.close();
  writeFileSync(
    control + "/browser-result.json",
    JSON.stringify(
      {
        source: process.env.HYBRID_BROWSER_SHA,
        chromium: browser.version(),
        cases,
        mockApi: false,
        database: "isolated-postgresql18",
        fabricAcceptance: false,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ result: "passed", cases }));
} catch (error) {
  writeFileSync(
    control + "/browser-diagnostics.json",
    JSON.stringify(
      {
        cases,
        events: browserEvents,
        chains: await db.supplyChain.findMany({
          where: { name: ownerChainName ?? "__missing__" },
          select: { id: true, businessProfile: true },
        }),
      },
      null,
      2,
    ),
  );
  if (lastPage && !lastPage.isClosed()) {
    await lastPage
      .screenshot({ path: control + "/failure.png", fullPage: true })
      .catch(() => {});
    writeFileSync(
      control + "/failure.html",
      await lastPage.content().catch(() => ""),
    );
  }
  throw error;
} finally {
  await browser.close();
  await db.$disconnect();
}
