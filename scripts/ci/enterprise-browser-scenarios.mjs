import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { loginToDashboard, redactDiagnostic } from './hybrid-browser-login.mjs';

const timeout = 45_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const until = async (check, description, limit = timeout) => {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) { if (await check()) return; await delay(200); }
  throw new Error(`Enterprise browser did not settle: ${description}`);
};
const command = async (page, route, click) => {
  const reply = page.waitForResponse(response => new URL(response.url()).pathname === `/api${route}` && response.request().method() === 'POST', { timeout });
  // A failed click must surface as the error; the pending wait then ends with the browser.
  reply.catch(() => undefined);
  // The previous write's toast can cover this action on a phone-width layout,
  // and it pauses while the pointer rests on it: move away and let it close.
  await page.mouse.move(0, 0);
  await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout });
  await click();
  // Every write asks once in the shared confirmation dialog; steps that
  // already answered it leave nothing to click here.
  await page.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true })
    .click({ timeout: 3000 }).catch(() => undefined);
  const response = await reply;
  assert.equal(response.status(), 201, `Real UI command rejected at ${route}`);
  const envelope = await response.json();
  assert.equal(envelope.success, true);
  return envelope.data;
};
/** Ledger selects are Radix listboxes: open the trigger and pick the option by its label. */
async function choose(page, trigger, option) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function bothLayouts(page) {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `Enterprise UI must fit viewport width ${viewport.width}`);
  }
}
async function noPasswordStorage(page, password) {
  assert.ok(await page.evaluate(secret => [localStorage, sessionStorage]
    .every(storage => Object.keys(storage).every(key => !storage.getItem(key)?.includes(secret))), password),
  'Registration password must never enter browser storage');
}

export async function runEnterpriseBrowserScenarios(options) {
  const browser = await chromium.launch({ headless: true,
    ...(options.chromiumExecutablePath ? { executablePath: options.chromiumExecutablePath } : {}) });
  const contexts = [];
  const results = [];
  let activePage, activeMode, phase;
  const step = value => { phase = value; console.log(JSON.stringify({ suite: 'enterprise-browser', mode: activeMode, phase })); };
  const context = async address => {
    const value = await browser.newContext({ viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address}` } });
    contexts.push(value);
    return value;
  };
  const login = async (page, user, label) => {
    const result = await loginToDashboard(page, options.origin, user, options.operator.password,
      { evidenceDir: options.diagnosticsDir, privateDir: options.privateDir, label,
        // An enterprise owner lands on its workspace home; activation decides what it may open there.
        destination: label === 'enterprise-admin' ? '/admin' : ['/dashboard', '/enterprise'] });
    options.loginResults.push(result);
  };
  try {
    const adminContext = await context(200);
    const admin = await adminContext.newPage();
    activePage = admin;
    step('admin-login');
    await login(admin, options.operator.admin, 'enterprise-admin');
    let sequence = 201;
    for (const mode of ['platform-a', 'platform-b']) {
      activeMode = mode;
      const ownerContext = await context(sequence++);
      const owner = await ownerContext.newPage();
      activePage = owner;
      step('registration');
      const email = `${randomUUID()}@example.test`, organizationName = `UI enterprise ${randomUUID()}`;
      options.secrets.push(email);
      await owner.goto(`${options.origin}/register`, { waitUntil: 'networkidle' });
      // The address catalog is public reference data; pick the same province and ward by name.
      const catalog = await (await ownerContext.request.get(`${options.origin}/api/reference-data/addresses`)).json();
      const province = (catalog.data ?? catalog).find(item => item.code === '01');
      const ward = province?.wards.find(item => item.code === '00004');
      assert.ok(province && ward, 'Registration address fixture must exist in the catalog');
      // Step 1: participation status and organization (ADR-005). A producing
      // chain owner registers; its FARM capability is the default activity.
      await owner.getByRole('checkbox', { name: 'Đăng ký làm chủ chuỗi (dùng dịch vụ có phí)', exact: true }).check();
      await owner.locator('#organizationName').fill(organizationName);
      await owner.locator('#businessId').fill(Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join(''));
      await owner.locator('#registrationNumber').fill('UI-REG-' + randomUUID().slice(0, 8));
      await owner.locator('#upload-LEGAL_REGISTRATION').setInputFiles({
        name: 'registration.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% isolated registration fixture\n%%EOF\n'),
      });
      await choose(owner, owner.locator('#provinceCode'), province.name);
      await choose(owner, owner.locator('#wardCode'), ward.name);
      await owner.locator('#address').fill('123 Địa chỉ đăng ký cách ly');
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 2: representative and login email; no password is chosen here.
      const contactEmail = `contact-${randomUUID()}@example.test`;
      options.secrets.push(contactEmail);
      await owner.locator('#representative').fill('Đại diện demo');
      await owner.locator('#representativeTitle').fill('Giám đốc');
      await owner.locator('#phone').fill('0900000123');
      await owner.locator('#contactEmail').fill(contactEmail);
      await owner.locator('#fullName').fill('Đại diện demo');
      await owner.locator('#email').fill(email);
      assert.equal(await owner.locator('input[type="password"]').count(), 0, 'Registration must not ask for a password');
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 3: production details.
      await owner.locator('#productGroups').fill('Rau');
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 4: service and hosting mode.
      assert.equal(await owner.locator('#hostingMode').count(), 0);
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 5: review and consents.
      await owner.getByRole('checkbox', { name: 'Xác nhận thông tin chính xác', exact: true }).check();
      await owner.getByRole('checkbox', { name: 'Đồng ý điều khoản sử dụng', exact: true }).check();
      await owner.getByRole('checkbox', { name: 'Đã đọc chính sách quyền riêng tư', exact: true }).check();
      await bothLayouts(owner);
      let enrollmentId, originalDigest;
      let registrations = 0;
      // The server really commits; only the first response is lost in transport.
      const registerRoute = async route => {
        const body = route.request().postData();
        originalDigest ??= digest(body);
        assert.ok(originalDigest === digest(body), 'Registration retry must preserve original content and request ID');
        const response = await route.fetch();
        assert.equal(response.status(), 201);
        const result = (await response.json()).data;
        enrollmentId ??= result.enrollmentId;
        assert.equal(result.enrollmentId, enrollmentId);
        if (++registrations === 1) await route.abort('failed');
        else await route.fulfill({ response });
      };
      await owner.route('**/api/auth/register', registerRoute);
      // Sending opens the OTP dialog, which mails a code to the login email;
      // confirming the code sends the registration.
      const otpReceipt = await command(owner, '/auth/registration-otp/request', () =>
        owner.getByRole('button', { name: 'Gửi hồ sơ xét duyệt', exact: true }).click());
      const otp = await options.operator.readOtp(otpReceipt.verificationId);
      options.secrets.push(otp);
      const otpDialog = owner.getByRole('dialog', { name: 'Xác thực email đăng nhập', exact: true });
      await otpDialog.getByLabel('Mã OTP', { exact: true }).fill(otp);
      await command(owner, '/auth/registration-otp/verify', () =>
        otpDialog.getByRole('button', { name: 'Xác thực và gửi hồ sơ', exact: true }).click());
      // Next.js keeps an empty route announcer alert; wait for the real one.
      await owner.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout });
      step('registration-recovery');
      // The modal OTP dialog hides the form from the accessibility tree; read the control itself.
      assert.equal(await owner.locator('#declaration').isDisabled(), true);
      await noPasswordStorage(owner, otp);
      // Reconciling reuses the original request (same body and request ID).
      await otpDialog.getByRole('button', { name: 'Đối soát', exact: true }).click();
      await owner.getByRole('heading', { name: 'Đã gửi hồ sơ xét duyệt', exact: true }).waitFor({ timeout });
      assert.equal(registrations, 2);
      await owner.unroute('**/api/auth/register', registerRoute);
      const pending = await options.operator.assertPending(enrollmentId);
      let authorization;
      owner.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.headers().authorization)
          authorization = request.headers().authorization;
      });
      step('owner-first-login');
      const temporary = await options.operator.readTemporaryPassword(enrollmentId);
      options.secrets.push(temporary);
      options.loginResults.push(await loginToDashboard(owner, options.origin, { email }, temporary,
        { evidenceDir: options.diagnosticsDir, privateDir: options.privateDir, label: `enterprise-${mode}-first`,
          destination: '/account/password' }));
      await owner.getByLabel(/^Mật khẩu (tạm|hiện tại)$/).fill(temporary);
      await owner.getByLabel('Mật khẩu mới', { exact: true }).fill(options.operator.password);
      await owner.getByLabel('Nhập lại mật khẩu mới', { exact: true }).fill(options.operator.password);
      await owner.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
      await owner.getByRole('dialog', { name: 'Xác nhận đổi mật khẩu', exact: true })
        .getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
      await owner.waitForURL(url => url.pathname === '/login', { timeout });
      step('owner-login');
      await login(owner, { email }, `enterprise-${mode}`);
      await owner.goto(`${options.origin}/enterprise/onboarding`, { waitUntil: 'domcontentloaded' });
      // The compact enterprise header replaces quick search with the review status.
      await owner.getByRole('heading', { name: 'Thông tin đăng ký', exact: true }).first().waitFor({ timeout });
      await owner.getByRole('status').filter({ hasText: 'CHỜ XÉT DUYỆT' }).first().waitFor({ timeout });
      await bothLayouts(owner);
      await until(() => authorization, 'owner authentication');
      const denied = await ownerContext.request.post(`${options.origin}/api/supply-chains`, {
        headers: { authorization, origin: options.origin, 'idempotency-key': randomUUID() }, data: { name: 'Must be denied before approval' } });
      assert.equal(denied.status(), 403, 'Unapproved signup must not create a chain');
      activePage = admin;
      step('admin-enrollment-review');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}`, { waitUntil: 'domcontentloaded' });
      const decision = admin.getByRole('complementary', { name: 'Quyết định', exact: true });
      await decision.getByLabel('Ghi chú gửi doanh nghiệp', { exact: true }).fill('Đã kiểm hồ sơ doanh nghiệp demo cách ly');
      await bothLayouts(admin);
      await command(admin, `/enterprise-enrollments/${enrollmentId}/review`, () =>
        decision.getByRole('button', { name: 'Ghi quyết định', exact: true }).click());
      assert.equal(await options.operator.db.organizationCapability.count({ where: { organizationId: pending.organizationId } }), 0);
      // Each requested capability is approved on its own before activation.
      step('admin-capability-review');
      const reviewCapability = admin.getByRole('button', { name: 'Xét năng lực', exact: true });
      await reviewCapability.first().waitFor({ timeout });
      for (let pendingCapabilities = await reviewCapability.count(); pendingCapabilities > 0;
        pendingCapabilities = await reviewCapability.count()) {
        await reviewCapability.first().click();
        const dialog = admin.getByRole('dialog', { name: /^Xét năng lực / });
        await dialog.getByLabel('Ghi chú gửi doanh nghiệp', { exact: true }).fill('Đã đối chiếu năng lực trong kiểm thử cách ly');
        const reviewed = admin.waitForResponse(response => /^\/api\/capability-requests\/[^/]+\/review$/.test(new URL(response.url()).pathname) &&
          response.request().method() === 'POST', { timeout });
        await dialog.getByRole('button', { name: 'Ghi quyết định', exact: true }).click();
        assert.equal((await reviewed).status(), 201, 'Capability review must be accepted');
        await until(async () => await reviewCapability.count() < pendingCapabilities, 'capability decision recorded');
      }
      // A paying producer chooses a plan, accepts the contract and pays its
      // first invoice before the platform may activate it.
      activePage = owner;
      step('owner-service-purchase');
      await owner.goto(`${options.origin}/enterprise/service`, { waitUntil: 'domcontentloaded' });
      assert.equal(await owner.getByRole('combobox', { name: 'Hình thức vận hành', exact: true }).count(), 0);
      await owner.getByLabel('Địa chỉ thanh toán', { exact: true }).fill('123 Địa chỉ hóa đơn cách ly');
      const previewed = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/enterprise-service/preview' &&
        response.request().method() === 'POST', { timeout });
      await owner.getByRole('button', { name: 'Tiếp tục · Kiểm tra hợp đồng', exact: true }).click();
      assert.ok([200, 201].includes((await previewed).status()), 'Service preview must succeed');
      await owner.waitForURL(url => url.pathname === '/enterprise/service/contract', { timeout });
      await owner.getByRole('checkbox', { name: /^Tôi đã kiểm tra và đồng ý với bản hợp đồng PDF/ }).check();
      await command(owner, '/enterprise-service/orders', () =>
        owner.getByRole('button', { name: 'Xác nhận và thanh toán', exact: true }).click());
      await owner.getByRole('dialog', {name:'Thanh toán dịch vụ',exact:true}).waitFor({timeout});
      await command(owner, '/enterprise-service/payment-simulation', () =>
        owner.getByRole('button', { name: 'Thanh toán mô phỏng', exact: true }).click());
      // ADR-005: capabilities were reviewed first, so the chain owner's paid
      // plan activates the enterprise; no administrator activation remains.
      step('payment-activation');
      await until(async () => !!(await options.operator.db.enterpriseEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } })).serviceActivatedAt,
        'activation by the chain owner payment', 30_000);
      activePage = owner;
      step('owner-create-chain');
      await owner.goto(`${options.origin}/supply-chains/new`, { waitUntil: 'domcontentloaded' });
      const create = owner.getByRole('dialog', { name: 'Tạo chuỗi cung ứng', exact: true });
      await create.getByLabel('Tên chuỗi', { exact: true }).fill(`Enterprise chain ${randomUUID()}`);
      await choose(owner, create.getByRole('combobox', { name: 'Loại chuỗi', exact: true }), 'Trồng trọt');
      // Without invited partners the supply model is the owner's approved production stage.
      await create.getByText('Khâu của doanh nghiệp bạn: Sản xuất', { exact: true }).waitFor({ timeout });
      const chain = await command(owner, '/supply-chains', () =>
        create.getByRole('button', { name: 'Tạo chuỗi', exact: true }).click());
      assert.equal(chain.ownerOrganizationId, pending.organizationId);
      step('automatic-ledger-provisioning');
      await until(async () => (await options.operator.db.ledgerProvisioningJob.findUniqueOrThrow({ where: { chainId: chain.id } })).status === 'COMPLETED', 'automatic chain provisioning', 120_000);
      const proof = await options.operator.verifyProvisioning(enrollmentId, chain.id);
      const personal = await options.operator.db.supplyChain.findFirstOrThrow({ where: { ownerOrganizationId: pending.organizationId, personal: true } });
      await until(async () => (await options.operator.db.ledgerProvisioningJob.findUniqueOrThrow({ where: { chainId: personal.id } })).status === 'COMPLETED', 'automatic personal chain provisioning', 120_000);
      await options.operator.verifyProvisioning(enrollmentId, personal.id);
      assert.equal(await owner.getByLabel('Peer host', { exact: true }).count(), 0);
      await owner.goto(`${options.origin}/supply-chains/${chain.id}/ledger`, { waitUntil: 'domcontentloaded' });
      await owner.getByText(/Sổ cái của chuỗi đã sẵn sàng/).waitFor({ timeout });
      await bothLayouts(owner);
      await noPasswordStorage(owner, options.operator.password);
      results.push({ mode, viewports: [1365, 390], registrationRetries: registrations,
        signupWithoutGrants: true, automaticPersonalAndCreatedChain: true, ...proof });
    }
    return { passed: results.length, failed: 0, skipped: 0, browser: 'Chromium desktop/mobile viewport; not physical iOS acceptance', flows: results };
  } catch (error) {
    const alerts = await activePage?.getByRole('alert').allTextContents().catch(() => []) ?? [];
    const main = await activePage?.locator('main').first().innerText({ timeout: 2000 }).catch(() => '') ?? '';
    const dialogs = await activePage?.getByRole('dialog').allTextContents().catch(() => []) ?? [];
    const screens = await activePage?.locator('[data-testid^="ledger-screen-"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid'))).catch(() => []) ?? [];
    console.error(JSON.stringify({ suite: 'enterprise-browser', mode: activeMode, phase,
      path: activePage ? new URL(activePage.url()).pathname : undefined,
      alerts: alerts.map(value => redactDiagnostic(value, options.secrets)),
      screens, dialogs: dialogs.map(value => redactDiagnostic(value.replace(/\s+/g, ' ').slice(0, 3000), options.secrets)),
      main: redactDiagnostic(main.replace(/\s+/g, ' ').slice(0, 1200), options.secrets) }));
    throw error;
  } finally {
    for (const value of contexts) await value.close();
    await browser.close();
  }
}
