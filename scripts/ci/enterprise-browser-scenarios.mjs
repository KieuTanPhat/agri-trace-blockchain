import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { loginToDashboard } from './hybrid-browser-login.mjs';

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
  const context = async address => {
    const value = await browser.newContext({ viewport: { width: 1365, height: 900 },
      extraHTTPHeaders: { 'X-Forwarded-For': `198.51.100.${address}` } });
    contexts.push(value);
    return value;
  };
  const login = async (page, user, label) => {
    const result = await loginToDashboard(page, options.origin, user, options.operator.password,
      { evidenceDir: options.diagnosticsDir, privateDir: options.privateDir, label });
    options.loginResults.push(result);
  };
  try {
    const adminContext = await context(200);
    const admin = await adminContext.newPage();
    await login(admin, options.operator.admin, 'enterprise-admin');
    let sequence = 201;
    for (const mode of ['MANAGED_ORG', 'SELF_MANAGED_ORG']) {
      const ownerContext = await context(sequence++);
      const owner = await ownerContext.newPage();
      const email = `${randomUUID()}@example.test`, organizationName = `UI enterprise ${randomUUID()}`;
      options.secrets.push(email);
      await owner.goto(`${options.origin}/register`, { waitUntil: 'networkidle' });
      await owner.getByLabel('Tên doanh nghiệp', { exact: true }).fill(organizationName);
      await owner.getByLabel('Mã số doanh nghiệp / mã số thuế', { exact: true }).fill(`UI-${randomUUID().slice(0, 12)}`);
      await owner.getByLabel('Người đại diện', { exact: true }).fill('Đại diện demo');
      await owner.getByLabel('Email', { exact: true }).fill(email);
      await owner.getByLabel(/^Mật khẩu/).fill(options.operator.password);
      await owner.locator(`input[name="hostingMode"][value="${mode}"]`).check();
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
      await owner.getByRole('button', { name: 'Gửi đăng ký', exact: true }).click();
      await owner.getByRole('alert').waitFor({ state: 'visible', timeout });
      assert.equal(await owner.getByLabel('Tên doanh nghiệp', { exact: true }).isDisabled(), true);
      await noPasswordStorage(owner, options.operator.password);
      await owner.getByRole('button', { name: 'Thử lại đăng ký ban đầu', exact: true }).click();
      await owner.getByRole('heading', { name: 'Đã tiếp nhận đăng ký', exact: true }).waitFor({ timeout });
      assert.equal(registrations, 2);
      await owner.unroute('**/api/auth/register', registerRoute);
      const pending = await options.operator.assertPending(enrollmentId);
      let authorization;
      owner.on('request', request => {
        if (new URL(request.url()).pathname.startsWith('/api/') && request.headers().authorization)
          authorization = request.headers().authorization;
      });
      await login(owner, { email }, `enterprise-${mode}`);
      await owner.goto(`${options.origin}/enterprise`, { waitUntil: 'domcontentloaded' });
      await owner.getByRole('status').filter({ hasText: 'Chờ xét duyệt' }).waitFor({ timeout });
      assert.equal(await owner.getByRole('heading', { name: 'Kết nối một chuỗi', exact: true }).count(), 0);
      await bothLayouts(owner);
      await until(() => authorization, 'owner authentication');
      const denied = await ownerContext.request.post(`${options.origin}/api/supply-chains`, {
        headers: { authorization, origin: options.origin, 'idempotency-key': randomUUID() }, data: { name: 'Must be denied before approval' } });
      assert.equal(denied.status(), 403, 'Unapproved signup must not create a chain');
      await admin.goto(`${options.origin}/admin/enterprises`, { waitUntil: 'domcontentloaded' });
      let row = admin.locator('section.panel').filter({ has: admin.getByRole('heading', { name: organizationName, exact: true }) });
      await row.getByLabel('Ghi chú xét duyệt', { exact: true }).fill('Đã kiểm hồ sơ doanh nghiệp demo cách ly');
      await bothLayouts(admin);
      await command(admin, `/enterprise-enrollments/${enrollmentId}/review`, () => row.getByRole('button', { name: 'Phê duyệt', exact: true }).click());
      await owner.reload({ waitUntil: 'domcontentloaded' });
      await owner.getByRole('link', { name: 'Tạo chuỗi của doanh nghiệp', exact: true }).click();
      await owner.getByLabel('Tên chuỗi *', { exact: true }).fill(`Enterprise chain ${randomUUID()}`);
      const chain = await command(owner, '/supply-chains', () => owner.getByRole('button', { name: 'Tạo chuỗi cung ứng', exact: true }).click());
      assert.equal(chain.ownerOrganizationId, pending.organizationId);
      await owner.goto(`${options.origin}/enterprise`, { waitUntil: 'domcontentloaded' });
      await owner.getByLabel('Chuỗi của doanh nghiệp', { exact: true }).selectOption(chain.id);
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
      await admin.reload({ waitUntil: 'domcontentloaded' });
      row = admin.locator('section.panel').filter({ has: admin.getByRole('heading', { name: organizationName, exact: true }) });
      const request = row.locator('article').filter({ hasText: connection.id });
      await request.getByLabel('Ghi chú xét duyệt', { exact: true }).fill('Đã đối chiếu thông tin peer công khai');
      await command(admin, `/enterprise-connections/${connection.id}/review`, () => request.getByRole('button', { name: 'Phê duyệt', exact: true }).click());
      const approved = await options.operator.db.enterpriseConnection.findUniqueOrThrow({ where: { id: connection.id } });
      assert.equal(approved.status, 'APPROVED', 'Admin review alone must never report CONNECTED');
      assert.equal(approved.txId, null);
      // Test-only provisioning performs real registry approvals and updates the
      // operator-owned inventories; it never edits the connection result.
      await options.operator.provision(enrollmentId, chain.id, connection.id);
      await until(async () => {
        const value = await options.operator.db.enterpriseConnection.findUniqueOrThrow({ where: { id: connection.id } });
        assert.ok(!['FAILED', 'REJECTED'].includes(value.status), 'Real connection probe failed');
        return value.status === 'CONNECTED';
      }, 'real Fabric connection proof', 120_000);
      const proof = await options.operator.verifyProbe(connection.id);
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
  } finally {
    for (const value of contexts) await value.close();
    await browser.close();
  }
}
