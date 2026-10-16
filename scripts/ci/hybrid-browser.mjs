import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { repository, withHybridStack } from './hybrid-fabric.mjs';
import { redactDiagnostic } from './hybrid-browser-login.mjs';

const freePort = async () => {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
};

const enterpriseOnly = process.argv.includes('--enterprise-only');
assert.ok(process.argv.slice(2).every(argument => argument === '--enterprise-only'), 'Unknown browser harness argument');
await withHybridStack(async ({ env, root, evidenceDir, receipt, npm }) => {
  env.HYBRID_BROWSER_TESTS = '1';
  env.FABRIC_ENABLED = 'true';
  env.FABRIC_LEGACY_WRITER = 'false';
  env.FABRIC_WORKER_INTERVAL_MS = '500';
  env.ENTERPRISE_ONBOARDING_ENABLED = 'true';
  env.NEXT_PUBLIC_API_BASE_URL = '/api';
  env.NEXT_PUBLIC_USE_MOCK_API = 'false';
  env.FABRIC_BINDINGS_CONFIG = path.join(root, 'browser-bindings.json');
  writeFileSync(env.FABRIC_BINDINGS_CONFIG, JSON.stringify({ version: 1, bindings: [] }), { mode: 0o600 });
  env.ENTERPRISE_CONNECTIONS_CONFIG = path.join(root, 'browser-enterprise-targets.json');
  writeFileSync(env.ENTERPRISE_CONNECTIONS_CONFIG, JSON.stringify({ version: 1, targets: [] }), { mode: 0o600 });
  env.HYBRID_WEB_PORT = String(await freePort());
  npm('run', 'build', '--workspace', 'apps/api');
  npm('run', 'build', '--workspace', 'apps/web');
  const processes = [];
  const fixtures = [];
  const expiryHandles = [];
  const processLogs = [];
  const loginResults = [];
  const enterpriseSecrets = [];
  let enterpriseOperator;
  const start = (args, ipc = false) => {
    const child = spawn(process.execPath, args, { cwd: repository, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
    const output = { process: args.includes('--worker') ? 'worker' : ipc ? 'api' : 'web', stdout: '', stderr: '' };
    processLogs.push(output);
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', data => {
      output[stream] = (output[stream] + data.toString()).slice(-128 * 1024);
    });
    processes.push(child);
    child.once('error', () => {});
    return child;
  };
  const ready = child => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Isolated browser application startup timed out')), 45_000);
    child.once('message', value => { clearTimeout(timer); value.ready ? resolve(value) : reject(new Error('Browser startup rejected')); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated browser process exited before ready')); });
  });
  try {
    const web = start(['node_modules/next/dist/bin/next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', env.HYBRID_WEB_PORT]);
    const api = start(['scripts/ci/hybrid-browser-server.mjs'], true);
    const { origin } = await ready(api);
    for (let i = 0; i < 90; i++) {
      try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1500) })).status === 200) break; }
      catch { /* retry own startup */ }
      if (i === 89) throw new Error('Production Web pages did not become ready');
      assert.equal(web.exitCode, null); await delay(1000);
    }
    const { createBrowserFixture } = await import('./hybrid-browser-fixture.mjs');
    const { runHybridBrowserScenarios, prepareHybridBrowserExpiry } = await import('./hybrid-browser-scenarios.mjs');
    for (const variant of enterpriseOnly ? [] : ['desktop', 'mobile']) {
      const fixture = await createBrowserFixture(env, origin, `${variant}-${receipt.instance}`, { waitForWorker: false });
      fixture.variant = variant;
      fixtures.push(fixture);
    }
    // The Worker loads the initial bindings and reloads atomic inventory updates
    // when the enterprise operator later provisions the newly registered chains.
    const worker = start(['scripts/ci/hybrid-browser-server.mjs', '--worker'], true);
    const workerReady = await ready(worker);
    for (const fixture of fixtures) {
      const variant = fixture.variant;
      await fixture.waitForAuthority();
      const options = { origin, ...fixture, variant, workerOrigin: workerReady.origin,
        diagnosticsDir: path.join(evidenceDir, 'browser-diagnostics'), privateDir: root, loginResults, hydrationDelayMs: 1000,
        chromiumExecutablePath: process.env.HYBRID_CHROMIUM_EXECUTABLE };
      const expiry = await prepareHybridBrowserExpiry(options);
      expiryHandles.push({ variant, options, expiry });
    }
    const { createEnterpriseBrowserFixture } = await import('./enterprise-browser-fixture.mjs');
    const { runEnterpriseBrowserScenarios } = await import('./enterprise-browser-scenarios.mjs');
    enterpriseOperator = await createEnterpriseBrowserFixture(env);
    enterpriseSecrets.push(enterpriseOperator.password, enterpriseOperator.admin.email);
    receipt.suites.push({ name: 'enterprise-browser', status: 'running' });
    const enterpriseResult = await runEnterpriseBrowserScenarios({ origin, operator: enterpriseOperator,
      diagnosticsDir: path.join(evidenceDir, 'browser-diagnostics'), privateDir: root, loginResults, secrets: enterpriseSecrets,
      chromiumExecutablePath: process.env.HYBRID_CHROMIUM_EXECUTABLE });
    assert.equal(enterpriseResult.failed, 0);
    assert.equal(enterpriseResult.passed, 2);
    receipt.suites.at(-1).status = 'passed';
    receipt.suites.at(-1).results = enterpriseResult;
    for (const { variant, options, expiry } of expiryHandles) {
      receipt.suites.push({ name: `browser-${variant}`, status: 'running' });
      const result = await runHybridBrowserScenarios({ ...options, browserSession: expiry.session });
      assert.equal(result.failed, 0);
      assert.ok(result.passed > 0);
      receipt.suites.at(-1).status = 'passed';
      receipt.suites.at(-1).results = result;
      // Separate viewport evidence does not establish real Safari/iOS hardware.
      if (variant === 'mobile') receipt.suites.at(-1).device = 'Chromium mobile viewport/touch emulation';
      if (variant === 'desktop') await delay(65_000); // Preserve existing login throttle between full auth runs.
    }
    const expiryResults = await Promise.all(expiryHandles.map(({ expiry }) => expiry.run()));
    for (let i = 0; i < expiryResults.length; i++) {
      const { variant } = expiryHandles[i];
      const result = expiryResults[i];
      assert.equal(result.failed, 0);
      receipt.suites.push({ name: `browser-${variant}-expiry`, status: 'passed', results: result });
    }
  } finally {
    receipt.loginResponses = loginResults.map(({ login, phase, hydrationWaitMs }) => ({ ...login, phase, hydrationWaitMs }));
    const secrets = [env.JWT_SECRET, env.IOT_INGEST_API_KEY, env.DATABASE_URL, ...enterpriseSecrets,
      ...fixtures.flatMap(({ fixture }) => [fixture.password, ...Object.values(fixture.users).map(user => user.email)])];
    receipt.browserProcessLogs = processLogs.map(output => ({
      process: output.process,
      stdout: redactDiagnostic(output.stdout, secrets),
      stderr: redactDiagnostic(output.stderr, secrets),
    }));
    for (const { expiry } of expiryHandles) await expiry.close();
    for (const fixture of fixtures) await fixture.close();
    await enterpriseOperator?.close();
    for (const child of processes) if (child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already stopped */ }
    }
    for (const child of processes) if (child.exitCode === null) {
      await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(10_000)]);
      if (child.exitCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already stopped */ }
        await new Promise(resolve => child.once('exit', resolve)); }
    }
    receipt.browserProcessCleanup = { verified: processes.every(child => child.exitCode !== null || child.signalCode !== null) };
    assert.ok(receipt.browserProcessCleanup.verified, 'Browser process cleanup incomplete');
  }
}, { suite: enterpriseOnly ? 'enterprise-browser' : 'hybrid-browser' });
