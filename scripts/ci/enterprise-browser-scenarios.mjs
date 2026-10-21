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
        destination: label === 'enterprise-admin' ? '/admin' : '/enterprise/onboarding' });
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
      // Step 1: role and organization.
      await owner.getByRole('radio', { name: /^Nhà sản xuất \/ Hợp tác xã/ }).check();
      await owner.locator('#reg-organizationName').fill(organizationName);
      await owner.locator('#reg-businessId').fill(Array.from({ length: 10 }, () => Math.floor(Math.random() * 10)).join(''));
      await owner.locator('#reg-registrationNumber').fill('UI-REG-' + randomUUID().slice(0, 8));
      await owner.locator('#reg-provinceCode').selectOption('01');
      await owner.locator('#reg-wardCode').selectOption('00004');
      await owner.locator('#reg-address').fill('123 Địa chỉ đăng ký cách ly');
      await owner.getByLabel('Tải giấy đăng ký của tổ chức', { exact: true }).setInputFiles({
        name: 'registration.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% isolated registration fixture\n%%EOF\n'),
      });
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 2: representative and login email; no password is chosen here.
      const contactEmail = `contact-${randomUUID()}@example.test`;
      options.secrets.push(contactEmail);
      await owner.locator('#reg-representative').fill('Đại diện demo');
      await owner.locator('#reg-representativeTitle').fill('Giám đốc');
      await owner.locator('#reg-phone').fill('0900000123');
      await owner.locator('#reg-contactEmail').fill(contactEmail);
      await owner.locator('#reg-fullName').fill('Đại diện demo');
      await owner.locator('#reg-email').fill(email);
      assert.equal(await owner.locator('input[type="password"]').count(), 0, 'Registration must not ask for a password');
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 3: production details.
      await owner.locator('#reg-productGroups').fill('Rau');
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 4: service and hosting mode.
      await owner.locator('#reg-hostingMode').selectOption(mode);
      await owner.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      // Step 5: review and consents.
      await owner.getByRole('checkbox', { name: /^Tôi xác nhận thông tin chính xác/ }).check();
      await owner.getByRole('checkbox', { name: /^Tôi đồng ý với/ }).check();
      await owner.getByRole('checkbox', { name: /^Tôi đã đọc/ }).check();
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
      await owner.getByRole('dialog').getByLabel('Mã OTP', { exact: true }).fill(otp);
      await command(owner, '/auth/registration-otp/verify', () =>
        owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận và gửi hồ sơ', exact: true }).click());
      // Next.js keeps an empty route announcer alert; wait for the real one.
      await owner.getByRole('alert').filter({ hasText: /\S/ }).first().waitFor({ state: 'visible', timeout });
      step('registration-recovery');
      assert.equal(await owner.getByRole('checkbox', { name: /^Tôi xác nhận thông tin chính xác/ }).isDisabled(), true);
      await noPasswordStorage(owner, otp);
      // Resending reuses the original request (same body and request ID).
      await owner.getByRole('button', { name: 'Gửi hồ sơ xét duyệt', exact: true }).click();
      await owner.getByRole('heading', { name: 'Cảm ơn bạn đã đăng ký AgriTrace', exact: true }).waitFor({ timeout });
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
      await owner.getByLabel(/^Mật khẩu hiện tại/).fill(temporary);
      await owner.getByLabel(/^Mật khẩu mới/).fill(options.operator.password);
      await owner.getByLabel(/^Nhập lại mật khẩu mới/).fill(options.operator.password);
      await owner.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
      await owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
      await owner.waitForURL(url => url.pathname === '/login', { timeout });
      step('owner-login');
      await login(owner, { email }, `enterprise-${mode}`);
      await owner.goto(`${options.origin}/enterprise/onboarding`, { waitUntil: 'domcontentloaded' });
      await owner.getByText('Chờ xét duyệt', { exact: true }).waitFor({ timeout });
      assert.equal(await owner.getByRole('heading', { name: 'Kết nối một chuỗi', exact: true }).count(), 0);
      await bothLayouts(owner);
      await until(() => authorization, 'owner authentication');
      const denied = await ownerContext.request.post(`${options.origin}/api/supply-chains`, {
        headers: { authorization, origin: options.origin, 'idempotency-key': randomUUID() }, data: { name: 'Must be denied before approval' } });
      assert.equal(denied.status(), 403, 'Unapproved signup must not create a chain');
      activePage = admin;
      step('admin-enrollment-review');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}`, { waitUntil: 'domcontentloaded' });
      await admin.getByLabel('Ghi chú xét duyệt', { exact: true }).fill('Đã kiểm hồ sơ doanh nghiệp demo cách ly');
      await bothLayouts(admin);
      await admin.getByRole('button', { name: 'Phê duyệt', exact: true }).click();
      await command(admin, `/enterprise-enrollments/${enrollmentId}/review`, () => admin.getByRole('button', { name: 'Xác nhận phê duyệt', exact: true }).click());
      assert.equal(await options.operator.db.organizationCapability.count({ where: { organizationId: pending.organizationId } }), 0);
      // Each requested capability is approved on its own before activation.
      step('admin-capability-review');
      const capabilityNote = '[aria-label^="Căn cứ duyệt năng lực"]';
      await admin.locator(capabilityNote).first().waitFor({ timeout });
      for (let pendingCapabilities = await admin.locator(capabilityNote).count(); pendingCapabilities > 0;
        pendingCapabilities = await admin.locator(capabilityNote).count()) {
        await admin.locator(capabilityNote).first().fill('Đã đối chiếu năng lực trong kiểm thử cách ly');
        const reviewed = admin.waitForResponse(response => /^\/api\/capability-requests\/[^/]+\/review$/.test(new URL(response.url()).pathname) &&
          response.request().method() === 'POST', { timeout });
        await admin.getByRole('button', { name: 'Duyệt năng lực', exact: true }).first().click();
        await admin.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true })
          .click({ timeout: 3000 }).catch(() => undefined);
        assert.equal((await reviewed).status(), 201, 'Capability review must be accepted');
        await admin.waitForFunction(([selector, before]) => document.querySelectorAll(selector).length < before,
          [capabilityNote, pendingCapabilities], { timeout });
      }
      // A paying producer chooses a plan, accepts the contract and pays its
      // first invoice before the platform may activate it.
      activePage = owner;
      step('owner-service-purchase');
      await owner.goto(`${options.origin}/enterprise/service`, { waitUntil: 'domcontentloaded' });
      await owner.locator('select[name="hostingMode"]').selectOption(mode);
      const previewed = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/enterprise-service/preview' &&
        response.request().method() === 'POST', { timeout });
      await owner.getByRole('button', { name: 'Xem trước hợp đồng', exact: true }).click();
      assert.ok([200, 201].includes((await previewed).status()), 'Service preview must succeed');
      await owner.waitForURL(url => url.pathname === '/enterprise/service/contract', { timeout });
      await owner.getByRole('checkbox', { name: /^Tôi đã đọc và đồng ý dùng hợp đồng thử nghiệm/ }).check();
      await command(owner, '/enterprise-service/orders', () =>
        owner.getByRole('button', { name: 'Xác nhận và đến thanh toán', exact: true }).click());
      await owner.waitForURL(url => url.pathname === '/enterprise/service/payment', { timeout });
      await command(owner, '/enterprise-service/payment-simulation', () =>
        owner.getByRole('button', { name: 'Mô phỏng thanh toán thành công', exact: true }).click());
      activePage = admin;
      step('admin-service-activation');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}`, { waitUntil: 'domcontentloaded' });
      await admin.getByLabel('Căn cứ kích hoạt (tối thiểu 10 ký tự)', { exact: true }).fill('Kích hoạt doanh nghiệp trong kiểm thử cách ly');
      await command(admin, `/enterprise-enrollments/${enrollmentId}/activate`, async () => {
        await admin.getByRole('button', { name: 'Cấp quyền sử dụng sau xét duyệt', exact: true }).click();
        await admin.getByRole('dialog').getByRole('button', { name: 'Xác nhận', exact: true }).click();
      });
      activePage = owner;
      step('owner-create-chain');
      await owner.goto(`${options.origin}/supply-chains/new`, { waitUntil: 'domcontentloaded' });
      await owner.getByLabel(/^Tên chuỗi/).fill(`Enterprise chain ${randomUUID()}`);
      await owner.getByLabel(/^Loại chuỗi/).selectOption('CROP');
      // The supply model is required: the owner performs production.
      await owner.getByRole('checkbox', { name: /— Sản xuất$/ }).first().check();
      const chain = await command(owner, '/supply-chains', async () => {
        await owner.getByRole('button', { name: 'Tạo chuỗi truy xuất', exact: true }).click();
        await owner.getByRole('dialog').getByRole('button', { name: 'Xác nhận tạo', exact: true }).click();
      });
      assert.equal(chain.ownerOrganizationId, pending.organizationId);
      step('owner-connection-request');
      await owner.goto(`${options.origin}/enterprise/connections`, { waitUntil: 'domcontentloaded' });
      await owner.getByLabel(/^Chuỗi của doanh nghiệp/).selectOption(chain.id);
      if (mode === 'SELF_MANAGED_ORG') {
        const peer = options.operator.publicPeer;
        await owner.getByLabel('Địa chỉ peer (IP hoặc DNS)', { exact: true }).fill(peer.peerHost);
        await owner.getByLabel('Cổng peer', { exact: true }).fill(String(peer.peerPort));
        await owner.getByLabel('Tên máy trong chứng thư TLS', { exact: true }).fill(peer.peerServerName);
        await owner.getByLabel('MSP của doanh nghiệp', { exact: true }).fill(peer.mspId);
        await owner.getByLabel('Chứng thư TLS CA công khai (PEM)', { exact: true }).fill(peer.tlsCaPem);
      } else assert.equal(await owner.locator('[name="peerHost"]').count(), 0);
      await bothLayouts(owner);
      const connection = await command(owner, '/enterprise-connections', () => owner.getByRole('button', { name: 'Gửi yêu cầu kết nối', exact: true }).click());
      await owner.getByText('Các chuỗi hiện có đã có yêu cầu kết nối.', { exact: false }).waitFor({ timeout });
      assert.equal(await owner.getByRole('button', { name: 'Gửi yêu cầu kết nối', exact: true }).count(), 0);
      activePage = admin;
      step('admin-connection-review');
      await admin.goto(`${options.origin}/admin/enterprises/${enrollmentId}/connections/${connection.id}`, { waitUntil: 'domcontentloaded' });
      await admin.getByLabel('Ghi chú xét duyệt', { exact: true }).fill('Đã đối chiếu thông tin peer công khai');
      await admin.getByRole('button', { name: 'Phê duyệt', exact: true }).click();
      await command(admin, `/enterprise-connections/${connection.id}/review`, () => admin.getByRole('button', { name: 'Xác nhận phê duyệt', exact: true }).click());
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
      await owner.getByRole('button', { name: 'Cập nhật trạng thái', exact: true }).click();
      await owner.getByRole('status').filter({ hasText: 'Đã kiểm chứng kết nối' }).waitFor({ timeout });
      await owner.getByText('Mã giao dịch kiểm chứng', { exact: true }).click();
      await owner.getByText(proof.txId, { exact: true }).waitFor({ timeout });
      await bothLayouts(owner);
      await noPasswordStorage(owner, options.operator.password);
      results.push({ mode, viewports: [1365, 390], registrationRetries: registrations,
        signupWithoutGrants: true, reviewBeforeProbe: true, ...proof });
    }
    return { passed: results.length, failed: 0, skipped: 0, browser: 'Chromium desktop/mobile viewport; not physical iOS acceptance', flows: results };
  } catch (error) {
    const alerts = await activePage?.getByRole('alert').allTextContents().catch(() => []) ?? [];
    console.error(JSON.stringify({ suite: 'enterprise-browser', mode: activeMode, phase,
      path: activePage ? new URL(activePage.url()).pathname : undefined,
      alerts: alerts.map(value => redactDiagnostic(value, options.secrets)) }));
    throw error;
  } finally {
    for (const value of contexts) await value.close();
    await browser.close();
  }
}
