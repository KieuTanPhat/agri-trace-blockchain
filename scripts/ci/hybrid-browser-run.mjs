import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const source = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
assert.equal(process.env.HYBRID_BROWSER_TESTS, "1");
assert.equal(process.env.HYBRID_BROWSER_SHA, source);
assert.match(
  process.env.TEST_DATABASE_URL ?? "",
  /@127\.0\.0\.1:25489\/browser_test$/,
);
assert.equal(process.env.DATABASE_URL, process.env.TEST_DATABASE_URL);
assert.equal(process.env.NODE_ENV, "test");
assert.equal(process.env.FABRIC_ENABLED, "false");
assert.equal(process.env.NEXT_PUBLIC_API_SAME_ORIGIN, "true");
assert.equal(process.env.NEXT_PUBLIC_MOCK_API, "false");
const control = process.env.HYBRID_BROWSER_CONTROL;
assert(control && isAbsolute(control));
mkdirSync(control, { recursive: false, mode: 0o700 });
const tracked = [
  "apps/api",
  "apps/web",
  "blockchain/gateway",
  "docs/sql",
  "package.json",
  "package-lock.json",
  "scripts/ci",
];
function unchanged() {
  execFileSync(
    "git",
    [
      "ls-files",
      "--error-unmatch",
      "scripts/ci/hybrid-browser-run.mjs",
      "scripts/ci/hybrid-browser-check.mjs",
      "scripts/ci/hybrid-browser-server.mjs",
      "scripts/ci/hybrid-browser-consent.mjs",
    ],
    { cwd: root, stdio: "pipe" },
  );
  execFileSync(
    "git",
    ["diff", "--exit-code", "--no-ext-diff", source, "--", ...tracked],
    { cwd: root, stdio: "pipe" },
  );
}
const children = [],
  streams = [];
let browserChild;
function child(label, args, extra = {}) {
  const fd = openSync(join(control, label + ".log"), "wx", 0o600);
  streams.push(fd);
  const processChild = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...extra },
    detached: process.platform !== "win32",
    stdio: ["ignore", fd, fd],
    windowsHide: true,
  });
  children.push(processChild);
  processChild.once("error", (error) => {
    processChild.startError = error;
  });
  return processChild;
}
function exitOf(processChild, timeout) {
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Isolated browser process deadline exceeded")),
      timeout,
    );
    processChild.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    processChild.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
}
async function stop(processChild) {
  if (
    !processChild.pid ||
    processChild.exitCode !== null ||
    processChild.signalCode !== null
  )
    return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/PID", String(processChild.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "pipe",
      });
    } catch {
      /* Already exited. */
    }
  } else {
    try {
      process.kill(-processChild.pid, "SIGTERM");
    } catch {
      /* Already exited. */
    }
    await Promise.race([
      new Promise((done) => processChild.once("exit", done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
    if (processChild.exitCode === null && processChild.signalCode === null)
      try {
        process.kill(-processChild.pid, "SIGKILL");
      } catch {
        /* Already exited. */
      }
  }
  if (processChild.exitCode === null && processChild.signalCode === null)
    await Promise.race([
      new Promise((done) => processChild.once("exit", done)),
      new Promise((done) => setTimeout(done, 5000)),
    ]);
}
try {
  unchanged();
  child(
    "web-runtime",
    [
      require.resolve("next/dist/bin/next", {
        paths: [join(root, "apps/web")],
      }),
      "start",
      join(root, "apps/web"),
      "-p",
      "25601",
      "-H",
      "127.0.0.1",
    ],
    { NODE_ENV: "production" },
  );
  child("api-runtime", [join(root, "scripts/ci/hybrid-browser-server.mjs")], {
    OPENAPI_EXPORT: "true",
  });
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (
      children.some(
        (item) =>
          item.startError || item.exitCode !== null || item.signalCode !== null,
      )
    )
      throw new Error("Isolated browser app exited before ready");
    try {
      const response = await fetch("http://127.0.0.1:25600/login", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) {
        await response.body?.cancel();
        ready = true;
        break;
      }
      await response.body?.cancel();
    } catch {
      /* Wait for the real app, without a mock readiness response. */
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  assert(ready, "Real browser app did not become ready");
  browserChild = child("browser-check", [
    "--import",
    "tsx",
    join(root, "scripts/ci/hybrid-browser-check.mjs"),
  ]);
  const result = await exitOf(browserChild, 300000);
  assert.equal(
    result.code,
    0,
    "Inspect retained synthetic browser diagnostics",
  );
  unchanged();
  const receipt = JSON.parse(
    readFileSync(join(control, "browser-result.json"), "utf8"),
  );
  assert.equal(receipt.source, source);
  assert.equal(receipt.mockApi, false);
  assert.equal(receipt.fabricAcceptance, false);
  assert.equal(receipt.cases.length, 7);
  assert.equal(new Set(receipt.cases).size, 7);
  console.log(JSON.stringify(receipt));
} finally {
  await Promise.all(children.map(stop));
  for (const fd of streams) closeSync(fd);
  const stopped = children.every(
    (item) => item.exitCode !== null || item.signalCode !== null,
  );
  writeFileSync(
    join(control, "app-cleanup.json"),
    JSON.stringify({
      source,
      appProcessesStopped: stopped,
    }),
    { mode: 0o600 },
  );
  assert(stopped, "Isolated browser app cleanup incomplete");
}
