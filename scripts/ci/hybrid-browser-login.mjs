import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep credentials, cookies and response bodies out of public diagnostics.
export function redactDiagnostic(value, secrets = []) {
  let text = String(value);
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length))
    text = text.split(secret).join('[REDACTED]');
  return text.replace(/eyJ[A-Za-z0-9_.-]+/g, '[REDACTED-JWT]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]+/gi, '[REDACTED-EMAIL]');
}
export async function loginToDashboard(page, origin, user, password, options = {}) {
  const timeout = options.timeout ?? 45_000;
  const secrets = [password, user.email];
  const redact = value => redactDiagnostic(value, secrets);
  const diagnostics = { phase: 'navigation', requests: [], console: [], pageErrors: [] };
  const onConsole = message => diagnostics.console.push({ type: message.type(), text: redact(message.text()).slice(0, 500) });
  const onError = error => diagnostics.pageErrors.push(redact(error.message).slice(0, 500));
  const onResponse = response => {
    const request = response.request();
    if (new URL(response.url()).pathname === '/api/auth/login') {
      const timing = request.timing();
      diagnostics.requests.push({ method: request.method(), status: response.status(),
        elapsedMs: timing.responseStart >= 0 ? timing.responseStart : null });
    }
  };
  page.on('console', onConsole); page.on('pageerror', onError); page.on('response', onResponse);
  await page.context().tracing.start({ screenshots: false, snapshots: true, sources: false });
  try {
    await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
    diagnostics.phase = 'hydration-and-session';
    const hydrationStarted = Date.now();
    // The SSR controls stay disabled until the mount effect and session restore finish.
    const button = page.getByRole('button', { name: 'Đăng nhập', exact: true });
    await page.waitForFunction(() => {
      const button = document.querySelector('button[type="submit"]');
      return button && !button.disabled;
    }, undefined, { timeout });
    diagnostics.hydrationWaitMs = Date.now() - hydrationStarted;
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    diagnostics.phase = 'login-response';
    const started = Date.now();
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login' &&
        response.request().method() === 'POST', { timeout }),
      button.click(),
    ]);
    diagnostics.login = { status: response.status(), elapsedMs: Date.now() - started };
    if (response.status() !== 201) {
      const body = await response.json().catch(() => ({}));
      if (/^[A-Z0-9_]{1,80}$/.test(body.error?.code ?? ''))
        diagnostics.login.errorCode = body.error.code;
      await page.getByRole('alert').waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
    }
    assert.equal(response.status(), 201, 'POST /api/auth/login must return 201');
    diagnostics.phase = 'destination';
    const destination = options.destination ?? '/dashboard';
    await page.waitForURL(url => url.pathname === destination, { timeout });
    await page.context().tracing.stop();
    return diagnostics;
  } catch (error) {
    diagnostics.error = { name: error.name, message: redact(error.message).split('\n')[0] };
    diagnostics.path = new URL(page.url()).pathname;
    diagnostics.alerts = (await page.getByRole('alert').allTextContents()).map(redact);
    if (options.evidenceDir && options.privateDir) {
      mkdirSync(options.evidenceDir, { recursive: true });
      mkdirSync(options.privateDir, { recursive: true, mode: 0o700 });
      const label = options.label ?? 'login';
      const raw = path.join(options.privateDir, label + '-raw.zip');
      const output = path.join(options.evidenceDir, label + '-trace.zip');
      await page.screenshot({ path: path.join(options.evidenceDir, label + '.png'),
        mask: [page.locator('input')], fullPage: true });
      await page.context().tracing.stop({ path: raw });
      const sanitizer = fileURLToPath(new URL('./sanitize-browser-trace.py', import.meta.url));
      execFileSync(process.platform === 'win32' ? 'python' : 'python3',
        [sanitizer, raw, output], { input: JSON.stringify(secrets), stdio: ['pipe', 'pipe', 'pipe'] });
      writeFileSync(path.join(options.evidenceDir, label + '.json'), JSON.stringify(diagnostics, null, 2));
    } else await page.context().tracing.stop();
    console.error('Hybrid browser login failed: ' + JSON.stringify(diagnostics));
    throw error;
  } finally {
    page.off('console', onConsole); page.off('pageerror', onError); page.off('response', onResponse);
  }
}
