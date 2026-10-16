import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices } from "playwright";
import { loginToDashboard } from "./hybrid-browser-login.mjs";

const loginTimes = [];
const loginOptions = new WeakMap();
let loginSequence = 0;
const storagePrefix = "agritrace-command:v1:";
const timeout = 45_000;
const api = (pathname) => `**/api${pathname}`;
// Each simulated person is a distinct client, as behind the production proxy (TRUST_PROXY_HOPS=1):
// the per-client throttles stay unchanged and one shared loopback address cannot exhaust them.
const clientAddress = (variant, party) =>
  `198.51.100.${(variant === "mobile" ? 120 : 20) + ["farm", "transporter", "retailer", "other"].indexOf(party)}`;

async function until(check, description, limit = timeout) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    let value;
    try {
      value = await check();
    } catch (error) {
      // A reload or redirect can destroy the page between two polls: poll again.
      if (!/Execution context was destroyed|navigation/i.test(String(error?.message)))
        throw error;
    }
    if (value) return value;
    await delay(150);
  }
  throw new Error(`Browser invariant did not settle: ${description}`);
}

async function login(page, origin, user, password) {
  // Keep the application limit. Tests never disable or increase throttling.
  while (loginTimes.filter((time) => Date.now() - time < 60_500).length >= 8)
    await delay(1000);
  loginTimes.push(Date.now());
  const options = loginOptions.get(page) ?? {};
  const result = await loginToDashboard(page, origin, user, password, {
    ...options,
    label: `${options.label ?? "login"}-${++loginSequence}`,
  });
  options.results?.push(result);
}

async function selectChain(page, options) {
  await page.goto(`${options.origin}/supply-chains`, {
    waitUntil: "domcontentloaded",
  });
  const select = page.getByLabel("Chọn chuỗi");
  await select.waitFor({ state: "visible", timeout });
  await until(
    async () =>
      (await select
        .locator(`option[value="${options.fixture.chainId}"]`)
        .count()) === 1,
    "current chain selection",
  );
  await select.selectOption(options.fixture.chainId);
}

async function requestResult(page, pattern, work) {
  const response = page.waitForResponse(
    (value) =>
      value.request().method() === "POST" &&
      pattern.test(new URL(value.url()).pathname),
    { timeout },
  );
  await work();
  const result = await response;
  assert.equal(result.status(), 201, "Real UI command must return 201");
  const envelope = await result.json();
  assert.equal(
    envelope.success,
    true,
    "Real UI command must return its data envelope",
  );
  return envelope.data;
}

async function openLot(page, options, lotId, { revoked = false } = {}) {
  await page.goto(`${options.origin}/lots/${lotId}`, {
    waitUntil: "domcontentloaded",
  });
  const panel = page.getByRole("region", {
    name: "Bàn giao hai bên",
    exact: true,
  });
  if (!revoked) return panel.waitFor({ state: "visible", timeout });
  // Without a current grant the API hides the lot (404): the page settles on the
  // not-found state and must never render the handover panel.
  await page
    .getByText("Không tìm thấy lô hàng")
    .waitFor({ state: "visible", timeout });
  assert.equal(await panel.count(), 0, "Revoked actor must not see the panel");
}

async function chooseKey(page, keyRef) {
  const select = page.getByLabel("Khóa ký cho bàn giao");
  await select.waitFor({ state: "visible", timeout });
  await until(() => select.isEnabled(), "signing queue ready");
  await select.selectOption(keyRef);
}

async function reviewOffer(page, options, shipment, keyRef, minutes) {
  await openLot(page, options, shipment.lotId);
  await chooseKey(page, keyRef);
  if (minutes !== undefined)
    await page
      .getByLabel("Hiệu lực đề nghị (phút)", { exact: true })
      .fill(String(minutes));
  const prepared = await requestResult(page, /\/handover-offers\/intent$/, () =>
    page.getByRole("button", { name: /^Đề nghị bàn giao:/ }).click(),
  );
  await page
    .getByRole("region", { name: "Xem lại trước khi ký", exact: true })
    .waitFor({ state: "visible", timeout });
  return prepared;
}

async function submitReviewed(page) {
  return requestResult(page, /\/signing-intents\/[^/]+\/submit$/, () =>
    page.getByRole("button", { name: "Ký và gửi", exact: true }).click(),
  );
}

async function confirm(page, options, shipment, keyRef, internal = false) {
  await openLot(page, options, shipment.lotId);
  await chooseKey(page, keyRef);
  await requestResult(page, /\/confirmation\/intent$/, () =>
    page
      .getByRole("button", {
        name: internal ? "Xác nhận nhận hàng nội bộ" : "Xác nhận nhận hàng",
        exact: true,
      })
      .click(),
  );
  if (internal)
    assert.equal(
      await page
        .getByText(/hai ý định giao và nhận vẫn phải được ký riêng/)
        .count(),
      1,
      "Same-org review must identify internal confirmation",
    );
  return submitReviewed(page);
}

async function commandMetadata(page, pathname) {
  return page.evaluate(
    ({ prefix, pathname }) => {
      for (const key of Object.keys(localStorage).filter((key) =>
        key.startsWith(prefix),
      )) {
        const ledger = JSON.parse(localStorage.getItem(key));
        for (const entry of Object.values(ledger.entries))
          if (entry.path === pathname)
            return {
              status: entry.status,
              key: entry.key,
              hasBody: typeof entry.body === "string",
              hasResult: "result" in entry,
            };
      }
      return null;
    },
    { prefix: storagePrefix, pathname },
  );
}

async function localKeyMetadata(page, keyRef) {
  return page.evaluate(
    (id) =>
      new Promise((resolve, reject) => {
        const opened = indexedDB.open("agritrace-signing", 1);
        opened.onerror = () =>
          reject(new Error("Device signing key database unavailable"));
        opened.onsuccess = () => {
          const db = opened.result;
          const transaction = db.transaction("keys", "readonly");
          const request = transaction.objectStore("keys").get(id);
          transaction.oncomplete = () => {
            const key = request.result;
            db.close();
            resolve(
              key
                ? {
                    present: true,
                    extractable: key.privateKey.extractable,
                    algorithm: key.privateKey.algorithm.name,
                  }
                : { present: false },
            );
          };
          transaction.onerror = transaction.onabort = () => {
            db.close();
            reject(new Error("Device signing key read failed"));
          };
        };
      }),
    keyRef,
  );
}

async function createSession(options) {
  const browser = await chromium.launch({
    headless: true,
    ...(options.chromiumExecutablePath
      ? { executablePath: options.chromiumExecutablePath }
      : {}),
  });
  const contexts = {};
  const pages = {};
  const tokens = new Map();
  const device = devices["iPhone 13"];
  const contextOptions =
    options.variant === "mobile"
      ? {
          viewport: device.viewport,
          deviceScaleFactor: device.deviceScaleFactor,
          isMobile: true,
          hasTouch: true,
          userAgent: device.userAgent,
        }
      : { viewport: { width: 1365, height: 900 } };
  try {
    for (const party of ["farm", "transporter", "retailer", "other"]) {
      contexts[party] = await browser.newContext({
        ...contextOptions,
        extraHTTPHeaders: {
          "X-Forwarded-For": clientAddress(options.variant, party),
        },
      });
      pages[party] = await contexts[party].newPage();
      loginOptions.set(pages[party], {
        evidenceDir: options.diagnosticsDir,
        privateDir: options.privateDir,
        label: `${options.variant}-${party}`,
        results: options.loginResults,
      });
      if (party === "farm" && options.hydrationDelayMs) {
        // Regression: static HTML arrives before the React login handlers.
        await pages[party].route("**/_next/static/**/*.js", async (route) => {
          await delay(options.hydrationDelayMs);
          await route.continue();
        });
      }
      pages[party].on("request", (request) => {
        if (request.url().startsWith(`${options.origin}/api/`)) {
          const token = request.headers().authorization;
          if (token) tokens.set(party, token);
        }
      });
      await login(
        pages[party],
        options.origin,
        options.fixture.users[party],
        options.fixture.password,
      );
      if (party === "farm" && options.hydrationDelayMs)
        await pages[party].unroute("**/_next/static/**/*.js");
    }
    return {
      browser,
      contexts,
      pages,
      tokens,
      keys: {},
      groups: [],
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function enrollKey(options, session, party, label, loseResponse = false) {
  const page = session.pages[party];
  await selectChain(page, options);
  const pathname = `/supply-chains/${options.fixture.chainId}/signing-keys`;
  let original;
  if (loseResponse)
    await page.route(api(pathname), async (route) => {
      if (route.request().method() !== "POST" || original)
        return route.continue();
      const request = route.request();
      original = {
        body: request.postData(),
        key: request.headers()["idempotency-key"],
      };
      const response = await route.fetch();
      assert.equal(
        response.status(),
        201,
        "Lost enrollment response must follow a real committed registration",
      );
      original.committed = true;
      await route.abort("failed");
    });
  const name = page.getByLabel("Tên khóa", { exact: true });
  await name.waitFor({ state: "visible", timeout });
  await name.fill(label);
  const button = page.getByRole("button", {
    name: "Tạo khóa ký trên thiết bị này",
    exact: true,
  });
  await until(() => button.isEnabled(), "key enrollment queue ready");
  let keyRef;
  if (loseResponse) {
    await button.click();
    await until(
      async () =>
        original?.committed &&
        (await commandMetadata(page, pathname))?.status === "PENDING",
      "original registration saved",
    );
    keyRef = JSON.parse(original.body).keyRef;
    assert.equal(
      (await localKeyMetadata(page, keyRef)).extractable,
      false,
      "Lost enrollment response must preserve the non-extractable key",
    );
    await page.unroute(api(pathname));
    await page.reload({ waitUntil: "domcontentloaded" });
    const queue = page.getByRole("region", {
      name: "Yêu cầu cần đối soát",
      exact: true,
    });
    await queue
      .getByText("Đăng ký khóa ký của tổ chức", { exact: true })
      .waitFor({ state: "visible", timeout });
    await queue
      .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
      .click();
    await until(
      async () =>
        (await commandMetadata(page, pathname))?.status === "COMMITTED",
      "registration positive journal",
    );
  } else {
    const registered = await requestResult(page, /\/signing-keys$/, () =>
      button.click(),
    );
    keyRef = registered.keyRef;
  }
  const key = await options.db.signingKey.findUnique({ where: { keyRef } });
  assert.equal(
    key?.organizationId,
    options.fixture.users[party].organizationId,
    "Registration must belong to the signed-in organization",
  );
  assert.deepEqual(
    await localKeyMetadata(page, keyRef),
    { present: true, extractable: false, algorithm: "Ed25519" },
    "Browser stores a non-extractable device key",
  );
  await options.activateKey(keyRef);
  await until(
    async () =>
      (await options.db.signingKey.findUnique({ where: { keyRef } }))
        ?.status === "ACTIVE",
    "real registry key activation",
  );
  return keyRef;
}

async function ensureKeys(options, session) {
  if (session.keys.farm) return;
  session.keys.farm = await enrollKey(
    options,
    session,
    "farm",
    `${options.variant} farm`,
    true,
  );
  session.keys.transporter = await enrollKey(
    options,
    session,
    "transporter",
    `${options.variant} transporter`,
  );
  session.keys.retailer = await enrollKey(
    options,
    session,
    "retailer",
    `${options.variant} retailer`,
  );
  await options.setHandoverMode("DUAL_SIGNED");
  session.groups.push({
    name: "device-key-enrollment-lost-response-reload-real-registry",
    passed: true,
  });
}

/** Keep the true signed expiry. The caller prepares desktop and mobile at the
 * start of one job, runs their other scenarios, then awaits both real deadlines. */
export async function prepareHybridBrowserExpiry(options) {
  const session = await createSession(options);
  try {
    await ensureKeys(options, session);
    const shipment = await options.createShipment();
    await reviewOffer(
      session.pages.farm,
      options,
      shipment,
      session.keys.farm,
      15,
    );
    const offered = await submitReviewed(session.pages.farm);
    const saved = await options.db.shipmentHandover.findUnique({
      where: { id: offered.id },
    });
    assert.equal(
      saved?.state,
      "OFFERED",
      "Expiry fixture must be a real signed offer",
    );
    const expiresAt = saved.expiresAt.toISOString();
    return {
      session,
      expiresAt,
      close: () => session.close(),
      run: async () => {
        const remaining = Date.parse(expiresAt) - Date.now();
        if (remaining > 0) await delay(remaining + 250);
        await openLot(session.pages.transporter, options, shipment.lotId);
        await until(
          async () =>
            (
              await options.db.shipmentHandover.findUnique({
                where: { id: offered.id },
              })
            )?.state === "EXPIRED",
          "real signed offer expiry",
          90_000,
        );
        await session.pages.transporter
          .getByText(/Hết hạn:/)
          .waitFor({ state: "visible", timeout });
        assert.equal(
          await session.pages.transporter
            .getByRole("button", { name: /^Xác nhận nhận hàng/ })
            .count(),
          0,
          "Expired offer must not expose confirmation",
        );
        const after = await options.db.shipment.findUnique({
          where: { id: shipment.shipmentId },
        });
        assert.equal(
          after?.status,
          "CREATED",
          "Expiry must preserve shipment custody",
        );
        assert.equal(
          after?.version,
          0,
          "Expiry must not increment shipment version",
        );
        return {
          variant: options.variant,
          passed: 1,
          failed: 0,
          skipped: 0,
          groups: [
            { name: "real-offer-expiry-custody-preserved", passed: true },
          ],
        };
      },
    };
  } catch (error) {
    await session.close();
    throw error;
  }
}

async function planConsent(options, session) {
  const created = await options.createPlan();
  for (const [party, label] of [
    ["farm", "sản xuất"],
    ["transporter", "vận chuyển"],
    ["retailer", "bán lẻ"],
  ]) {
    const page = session.pages[party];
    await selectChain(page, options);
    await requestResult(page, /\/shipment-plans\/[^/]+\/accept$/, () =>
      page
        .getByRole("button", { name: `Xác nhận vai trò ${label}`, exact: true })
        .click(),
    );
  }
  await selectChain(session.pages.farm, options);
  const finalized = await requestResult(
    session.pages.farm,
    /\/shipment-plans\/[^/]+\/finalize$/,
    () =>
      session.pages.farm
        .getByRole("button", {
          name: "Tạo chuyến theo kế hoạch đã xác nhận",
          exact: true,
        })
        .click(),
  );
  const plan = await options.db.shipmentPlan.findUnique({
    where: { id: created.planId },
    include: { revisions: { include: { acceptances: true } } },
  });
  assert.equal(
    plan?.status,
    "FINALIZED",
    "Three current UI consents must precede finalize",
  );
  assert.equal(
    plan?.revisions.find(
      (revision) => revision.revision === plan.currentRevision,
    )?.acceptances.length,
    3,
    "Each party has an immutable consent",
  );
  assert.ok(plan.shipmentId, "Finalized plan must name its shipment");
  assert.ok(finalized, "Finalize must return its real result");
  return { shipmentId: plan.shipmentId, lotId: created.lotId };
}

async function invitation(options, session) {
  await selectChain(session.pages.farm, options);
  const form = session.pages.farm
    .locator("form")
    .filter({
      has: session.pages.farm.getByRole("button", {
        name: "Mời đối tác",
        exact: true,
      }),
    });
  await form
    .getByLabel("Tổ chức", { exact: false })
    .selectOption(options.fixture.users.other.organizationId);
  await requestResult(session.pages.farm, /\/memberships$/, () =>
    form.getByRole("button", { name: "Mời đối tác", exact: true }).click(),
  );
  await selectChain(session.pages.other, options);
  await requestResult(
    session.pages.other,
    /\/memberships\/[^/]+\/accept$/,
    () =>
      session.pages.other
        .getByRole("button", { name: "Chấp nhận tham gia", exact: true })
        .click(),
  );
  assert.equal(
    await options.db.chainMembership.count({
      where: {
        chainId: options.fixture.chainId,
        organizationId: options.fixture.users.other.organizationId,
        status: "ACTIVE",
      },
    }),
    1,
    "Partner invitation acceptance must be real and scoped",
  );
}

async function lostResponseAndTabs(options, session, shipment) {
  const page = session.pages.farm;
  const prepared = await reviewOffer(
    page,
    options,
    shipment,
    session.keys.farm,
  );
  const pathname = `/signing-intents/${prepared.intentId}/submit`;
  let original;
  let writes = 0;
  const count = (request) => {
    if (
      new URL(request.url()).pathname === `/api${pathname}` &&
      request.method() === "POST"
    )
      writes += 1;
  };
  session.contexts.farm.on("request", count);
  await page.route(api(pathname), async (route) => {
    const request = route.request();
    original = {
      body: request.postData(),
      key: request.headers()["idempotency-key"],
    };
    const response = await route.fetch();
    assert.equal(
      response.status(),
      201,
      "Lost response must follow real server commit",
    );
    original.committed = true;
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Ký và gửi", exact: true }).click();
  await until(
    async () =>
      original?.committed &&
      (await commandMetadata(page, pathname))?.status === "PENDING",
    "original signature saved before reload",
  );
  assert.equal(
    await options.db.shipmentHandover.count({
      where: { shipmentId: shipment.shipmentId, state: "OFFERED" },
    }),
    1,
    "Lost response must have one real committed offer",
  );
  await page.unroute(api(pathname));
  await page.reload({ waitUntil: "domcontentloaded" });
  const second = await session.contexts.farm.newPage();
  await openLot(second, options, shipment.lotId);
  let release;
  let firstInspect;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const entered = new Promise((resolve) => {
    firstInspect = resolve;
  });
  let inspections = 0;
  await session.contexts.farm.route(
    api("/command-requests/status"),
    async (route) => {
      const request = route.request();
      const body = request.postDataJSON();
      if (body.operation !== "SUBMIT_SIGNED_INTENT") return route.continue();
      assert.equal(
        request.headers()["idempotency-key"],
        original.key,
        "Inspection must reuse the original idempotency key",
      );
      assert.equal(
        body.payload.signature,
        JSON.parse(original.body).signature,
        "Inspection must use the original signature",
      );
      const response = await route.fetch();
      inspections += 1;
      if (inspections === 1) {
        firstInspect();
        await held;
      }
      return route.fulfill({ response });
    },
  );
  try {
    const queue = (view) =>
      view.getByRole("region", { name: "Yêu cầu cần đối soát", exact: true });
    await queue(page)
      .getByText("Gửi chữ ký bàn giao", { exact: true })
      .waitFor({ state: "visible", timeout });
    await queue(second)
      .getByText("Gửi chữ ký bàn giao", { exact: true })
      .waitFor({ state: "visible", timeout });
    await queue(page)
      .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
      .click();
    await entered;
    await queue(second)
      .getByRole("button", { name: "Kiểm tra và thử lại", exact: true })
      .click();
    release();
    await until(
      async () =>
        (await commandMetadata(page, pathname))?.status === "COMMITTED",
      "positive signed journal recovered",
    );
    const metadata = await until(
      () => commandMetadata(page, pathname),
      "terminal command metadata readable after the page settles",
    );
    assert.equal(
      metadata.hasBody,
      false,
      "Terminal recovery must remove signature/body",
    );
    assert.equal(
      metadata.hasResult,
      false,
      "Terminal recovery must not cache a private response",
    );
    assert.equal(
      writes,
      1,
      "Two-tab reconciliation must not submit a second signed command",
    );
    assert.equal(
      await options.db.commandCommit.count({
        where: {
          requesterId: options.fixture.users.farm.id,
          operation: "SUBMIT_SIGNED_INTENT",
          idempotencyRecord: { idempotencyKey: original.key },
        },
      }),
      1,
      "Signed command journal must remain singular",
    );
    return { original, prepared, writes, inspections };
  } finally {
    release();
    await session.contexts.farm.unroute(api("/command-requests/status"));
    session.contexts.farm.off("request", count);
    await second.close();
  }
}

/** API/DB/Worker and registry are real; only transport responses are dropped.
 * All returns are metadata. Passwords, bearer tokens, signatures and payloads
 * stay in memory and never enter a public receipt, screenshot or trace. */
export async function runHybridBrowserScenarios(options) {
  const session = options.browserSession ?? (await createSession(options));
  const owned = !options.browserSession;
  const groups = [...session.groups];
  const group = async (name, work) => {
    await work();
    groups.push({ name, passed: true });
  };
  try {
    await ensureKeys(options, session);
    if (!groups.length) groups.push(...session.groups);
    await group("invitation-and-current-partner-acceptance-ui", () =>
      invitation(options, session),
    );
    let flow;
    await group(
      "three-party-current-consent-and-atomic-finalize-ui",
      async () => {
        flow = await planConsent(options, session);
      },
    );
    let recovery;
    await group(
      "signed-lost-response-reload-two-tabs-original-key",
      async () => {
        recovery = await lostResponseAndTabs(options, session, flow);
      },
    );
    await group(
      "independent-pickup-and-arrival-signatures-real-ledger",
      async () => {
        await confirm(
          session.pages.transporter,
          options,
          flow,
          session.keys.transporter,
        );
        assert.equal(
          (
            await options.db.shipment.findUnique({
              where: { id: flow.shipmentId },
            })
          )?.status,
          "IN_TRANSIT",
          "Pickup confirmation moves custody once",
        );
        await reviewOffer(
          session.pages.transporter,
          options,
          flow,
          session.keys.transporter,
        );
        await submitReviewed(session.pages.transporter);
        await confirm(
          session.pages.retailer,
          options,
          flow,
          session.keys.retailer,
        );
        assert.equal(
          (
            await options.db.shipment.findUnique({
              where: { id: flow.shipmentId },
            })
          )?.status,
          "ARRIVED",
          "Arrival confirmation moves custody once",
        );
        assert.equal(
          await options.db.shipmentHandover.count({
            where: { shipmentId: flow.shipmentId, state: "CONFIRMED" },
          }),
          2,
          "Both independent handovers confirmed",
        );
        await options.waitForProofs();
      },
    );
    await group("same-org-internal-offer-and-confirm-signatures", async () => {
      const internal = await options.createShipment({ sameOrg: true });
      await reviewOffer(
        session.pages.farm,
        options,
        internal,
        session.keys.farm,
      );
      const offered = await submitReviewed(session.pages.farm);
      assert.equal(
        offered.custodyLabel,
        "INTERNAL_SAME_ORG",
        "Same-org fixture must actually be internal",
      );
      await confirm(
        session.pages.farm,
        options,
        internal,
        session.keys.farm,
        true,
      );
      assert.equal(
        (
          await options.db.shipment.findUnique({
            where: { id: internal.shipmentId },
          })
        )?.status,
        "IN_TRANSIT",
        "Internal confirmation is required for custody",
      );
    });
    await group("reject-and-cancel-preserve-custody", async () => {
      for (const action of ["reject", "cancel"]) {
        const shipment = await options.createShipment();
        await reviewOffer(
          session.pages.farm,
          options,
          shipment,
          session.keys.farm,
        );
        const offered = await submitReviewed(session.pages.farm);
        const page =
          session.pages[action === "reject" ? "transporter" : "farm"];
        await openLot(page, options, shipment.lotId);
        if (action === "reject")
          page.once("dialog", (dialog) =>
            dialog.accept("Browser acceptance rejection"),
          );
        await requestResult(
          page,
          new RegExp(`/handovers/[^/]+/${action}$`),
          () =>
            page
              .getByRole("button", {
                name: action === "reject" ? "Từ chối" : "Hủy đề nghị",
                exact: true,
              })
              .click(),
        );
        assert.equal(
          (
            await options.db.shipmentHandover.findUnique({
              where: { id: offered.id },
            })
          )?.state,
          action === "reject" ? "REJECTED" : "CANCELLED",
          "Resolution has its terminal state",
        );
        const unchanged = await options.db.shipment.findUnique({
          where: { id: shipment.shipmentId },
        });
        assert.equal(
          unchanged?.status,
          "CREATED",
          "Reject/cancel never transfer custody",
        );
        assert.equal(
          unchanged?.version,
          0,
          "Reject/cancel never update shipment version",
        );
      }
    });
    await group("multiple-active-key-explicit-selection", async () => {
      const secondKey = await enrollKey(
        options,
        session,
        "farm",
        `${options.variant} second key`,
      );
      const shipment = await options.createShipment();
      await openLot(session.pages.farm, options, shipment.lotId);
      const selector = session.pages.farm.getByLabel("Khóa ký cho bàn giao");
      assert.equal(
        await selector.inputValue(),
        "",
        "Multiple active keys require explicit selection",
      );
      assert.equal(
        await session.pages.farm
          .getByRole("button", { name: /^Đề nghị bàn giao:/ })
          .isEnabled(),
        false,
        "No implicit key choice",
      );
      const prepared = await reviewOffer(
        session.pages.farm,
        options,
        shipment,
        secondKey,
      );
      assert.equal(
        prepared.keyRef,
        secondKey,
        "Prepared intent uses the explicitly selected key",
      );
      await session.pages.farm
        .getByRole("button", { name: "Không ký", exact: true })
        .click();
    });
    await group("account-switch-drops-review-and-response-scope", async () => {
      const shipment = await options.createShipment();
      await reviewOffer(
        session.pages.farm,
        options,
        shipment,
        session.keys.farm,
      );
      await session.pages.farm
        .getByRole("button", { name: "Đăng xuất", exact: true })
        .click();
      await session.pages.farm.waitForURL((url) => url.pathname === "/login", {
        timeout,
      });
      await login(
        session.pages.farm,
        options.origin,
        options.fixture.users.other,
        options.fixture.password,
      );
      await session.pages.farm.goto(
        `${options.origin}/lots/${shipment.lotId}`,
        { waitUntil: "domcontentloaded" },
      );
      assert.equal(
        await session.pages.farm
          .getByRole("region", { name: "Xem lại trước khi ký", exact: true })
          .count(),
        0,
        "An account switch discards the previous signing review",
      );
      assert.equal(
        await session.pages.farm
          .getByRole("button", { name: "Ký và gửi", exact: true })
          .count(),
        0,
        "Another account cannot submit the prior review",
      );
      await session.pages.farm
        .getByRole("button", { name: "Đăng xuất", exact: true })
        .click();
      await session.pages.farm.waitForURL((url) => url.pathname === "/login", {
        timeout,
      });
      await login(
        session.pages.farm,
        options.origin,
        options.fixture.users.farm,
        options.fixture.password,
      );
    });
    await group("current-grant-revocation-denies-terminal-replay", async () => {
      assert.equal(
        typeof options.revokeGrant,
        "function",
        "Browser fixture must implement real scoped grant revoke",
      );
      await options.waitForProofs();
      await options.revokeGrant(options.fixture.users.farm, "FARM_STAFF");
      await openLot(session.pages.farm, options, flow.lotId, { revoked: true });
      assert.equal(
        await session.pages.farm
          .getByRole("button", { name: /^Đề nghị bàn giao:|^Ký và gửi$/ })
          .count(),
        0,
        "Revocation removes signing actions",
      );
      const response = await session.contexts.farm.request.post(
        `${options.origin}/api/command-requests/status`,
        {
          headers: {
            authorization: session.tokens.get("farm"),
            "idempotency-key": recovery.original.key,
            origin: options.origin,
          },
          data: {
            operation: "SUBMIT_SIGNED_INTENT",
            payload: {
              intentId: recovery.prepared.intentId,
              ...JSON.parse(recovery.original.body),
            },
          },
        },
      );
      assert.ok(
        [403, 404].includes(response.status()),
        "Current authority must reject terminal replay after revoke",
      );
      assert.equal(
        await options.db.commandCommit.count({
          where: {
            requesterId: options.fixture.users.farm.id,
            operation: "SUBMIT_SIGNED_INTENT",
            idempotencyRecord: { idempotencyKey: recovery.original.key },
          },
        }),
        1,
        "Revoke does not rewrite the original positive journal",
      );
      // Restore is a new grant epoch, needed for the independently started
      // expiry scenario; old consent/command identities are never rewritten.
      assert.equal(
        typeof options.restoreGrant,
        "function",
        "Browser fixture must restore through a new grant epoch",
      );
      await options.restoreGrant(options.fixture.users.farm, "FARM_STAFF");
    });
    return {
      variant: options.variant,
      browser: "Chromium",
      emulation:
        options.variant === "mobile"
          ? "iPhone13 viewport/touch; not Safari/iOS device acceptance"
          : "desktop",
      passed: groups.length,
      failed: 0,
      skipped: 0,
      groups,
      requestCounts: {
        signedOriginalWrites: recovery.writes,
        signedStatusInspections: recovery.inspections,
      },
    };
  } finally {
    if (owned) await session.close();
  }
}
