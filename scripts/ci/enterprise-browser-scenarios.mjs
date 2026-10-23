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
    for (const mode of ['MANAGED_ORG', 'SELF_MANAGED_ORG']) {
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
      // Step 1: role and organization.
      await choose(owner, owner.locator('#registrationRole'), 'Nhà sản xuất / Hợp tác xã');
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
      await choose(owner, owner.locator('#hostingMode'),
        mode === 'MANAGED_ORG' ? 'AgriTrace quản lý peer' : 'Tự vận hành peer trên VPS');
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
      // The page header and the embedded profile section share this title.
      await owner.getByRole('heading', { name: 'Hồ sơ đăng ký', exact: true }).first().waitFor({ timeout });
      await owner.getByText('PENDING_REVIEW', { exact: true }).first().waitFor({ timeout });
      // Before approval the owner has no connection workspace.
      await owner.goto(`${options.origin}/enterprise/connections`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor({ timeout });
      assert.equal(await owner.getByRole('heading', { name: 'Kết nối doanh nghiệp', exact: true }).count(), 0);
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
      await choose(owner, owner.getByRole('combobox', { name: 'Hình thức vận hành', exact: true }),
        mode === 'MANAGED_ORG' ? 'AgriTrace quản lý peer' : 'Tự vận hành peer');
      await owner.getByLabel('Địa chỉ hóa đơn', { exact: true }).fill('123 Địa chỉ hóa đơn cách ly');
      const previewed = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/enterprise-service/preview' &&
        response.request().method() === 'POST', { timeout });
      await owner.getByRole('button', { name: 'Xem hợp đồng', exact: true }).click();
      assert.ok([200, 201].includes((await previewed).status()), 'Service preview must succeed');
      await owner.waitForURL(url => url.pathname === '/enterprise/service/contract', { timeout });
      await owner.getByRole('checkbox', { name: /^Tôi đã đọc và đồng ý nội dung hợp đồng/ }).check();
      await command(owner, '/enterprise-service/orders', () =>
        owner.getByRole('button', { name: 'Xác nhận hợp đồng', exact: true }).click());
      await owner.waitForURL(url => url.pathname === '/enterprise/service/payment', { timeout });
      await command(owner, '/enterprise-service/payment-simulation', () =>
        owner.getByRole('button', { name: 'Thanh toán mô phỏng', exact: true }).click());
      activePage = admin;
      step('admin-service-activation');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}`, { waitUntil: 'domcontentloaded' });
      await decision.getByLabel('Lý do kích hoạt thủ công', { exact: true }).fill('Kích hoạt doanh nghiệp trong kiểm thử cách ly');
      await command(admin, `/enterprise-enrollments/${enrollmentId}/activate`, () =>
        decision.getByRole('button', { name: 'Kích hoạt dịch vụ', exact: true }).click());
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
      step('owner-connection-request');
      await owner.goto(`${options.origin}/enterprise/connections`, { waitUntil: 'domcontentloaded' });
      await choose(owner, owner.getByRole('combobox', { name: 'Chuỗi', exact: true }), chain.name);
      if (mode === 'SELF_MANAGED_ORG') {
        const peer = options.operator.publicPeer;
        await owner.getByLabel('Peer host', { exact: true }).fill(peer.peerHost);
        await owner.getByLabel('Peer port', { exact: true }).fill(String(peer.peerPort));
        await owner.getByLabel('TLS server name', { exact: true }).fill(peer.peerServerName);
        await owner.getByLabel('MSP ID', { exact: true }).fill(peer.mspId);
        await owner.getByLabel('Chứng thư TLS công khai (PEM)', { exact: true }).fill(peer.tlsCaPem);
      } else assert.equal(await owner.getByLabel('Peer host', { exact: true }).count(), 0);
      await bothLayouts(owner);
      const connection = await command(owner, '/enterprise-connections', () => owner.getByRole('button', { name: 'Yêu cầu kết nối', exact: true }).click());
      await owner.getByText('Chưa có chuỗi đủ điều kiện để gửi yêu cầu kết nối mới.', { exact: true }).waitFor({ timeout });
      assert.equal(await owner.getByRole('button', { name: 'Yêu cầu kết nối', exact: true }).count(), 0);
      activePage = admin;
      step('admin-connection-review');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}/connections/${connection.id}`, { waitUntil: 'domcontentloaded' });
      await admin.getByRole('button', { name: 'Xét kết nối', exact: true }).click();
      const review = admin.getByRole('dialog', { name: 'Xét kết nối peer', exact: true });
      await review.getByLabel('Ghi chú', { exact: true }).fill('Đã đối chiếu thông tin peer công khai');
      await command(admin, `/enterprise-connections/${connection.id}/review`, () =>
        review.getByRole('button', { name: 'Ghi quyết định', exact: true }).click());
      const approved = await options.operator.db.enterpriseConnection.findUniqueOrThrow({ where: { id: connection.id } });
      assert.equal(approved.status, 'APPROVED', 'Admin review alone must never report CONNECTED');
      assert.equal(approved.txId, null);
      // Test-only provisioning performs real registry approvals and updates the
      // operator-owned inventories; it never edits the connection result.
      step('operator-provision');
      await options.operator.provision(enrollmentId, chain.id, connection.id);
      step('worker-proof');
      await until(async () => {
        const value = await options.operator.db.enterpriseConnection.findUniqueOrThrow({ where: { id: connection.id } });
        assert.ok(!['FAILED', 'REJECTED'].includes(value.status), 'Real connection probe failed');
        return value.status === 'CONNECTED';
      }, 'real Fabric connection proof', 120_000);
      const proof = await options.operator.verifyProbe(connection.id);
      activePage = owner;
      step('owner-connected');
      await owner.reload({ waitUntil: 'domcontentloaded' });
      await owner.getByText('Đã kiểm chứng kết nối', { exact: true }).first().waitFor({ timeout });
      await owner.getByText(proof.txId, { exact: true }).waitFor({ timeout });
      await bothLayouts(owner);
      await noPasswordStorage(owner, options.operator.password);
      results.push({ mode, viewports: [1365, 390], registrationRetries: registrations,
        signupWithoutGrants: true, reviewBeforeProbe: true, ...proof });
    }
    return { passed: results.length, failed: 0, skipped: 0, browser: 'Chromium desktop/mobile viewport; not physical iOS acceptance', flows: results };
  } catch (error) {
    const alerts = await activePage?.getByRole('alert').allTextContents().catch(() => []) ?? [];
    const main = await activePage?.locator('main').first().innerText({ timeout: 2000 }).catch(() => '') ?? '';
    console.error(JSON.stringify({ suite: 'enterprise-browser', mode: activeMode, phase,
      path: activePage ? new URL(activePage.url()).pathname : undefined,
      alerts: alerts.map(value => redactDiagnostic(value, options.secrets)),
      main: redactDiagnostic(main.replace(/\s+/g, ' ').slice(0, 1200), options.secrets) }));
    throw error;
  } finally {
    for (const value of contexts) await value.close();
    await browser.close();
  }
}
