import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PhoneAuthError, PhoneChallenge, normalizePhone, phoneError } = require('../../apps/mobile/src/auth/phone-challenge.ts') as typeof import('../../apps/mobile/src/auth/phone-challenge.ts');
const { SessionGate } = require('../../apps/mobile/src/auth/session-gate.ts') as typeof import('../../apps/mobile/src/auth/session-gate.ts');
const configureApp = require('../../apps/mobile/app.config.ts').default as typeof import('../../apps/mobile/app.config.ts').default;
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("normalizes Vietnam numbers and rejects foreign or malformed input", () => {
  assert.equal(normalizePhone("090 123 4567"), "+84901234567");
  assert.equal(normalizePhone("+84901234567"), "+84901234567");
  for (const phone of ["+11234567890", "123456", "09012345678"])
    assert.throws(() => normalizePhone(phone));
});
test("starts no SMS until requested and retains cooldown when returning to step one", async () => {
  let now = 0,
    requests = 0;
  const challenge = new PhoneChallenge(
    async () => {
      requests++;
      return { confirm: async () => "proof", dispose: async () => {} };
    },
    () => now,
  );
  assert.equal(requests, 0);
  await challenge.request("0901234567");
  assert.equal(requests, 1);
  await challenge.clear();
  await assert.rejects(challenge.request("0901234567"), /bộ đếm/);
  now += 60_000;
  await challenge.request("0901234567");
  assert.equal(requests, 2);
});
test("blocks parallel send and stale challenge after the user leaves", async () => {
  let resolve!: (v: {
    confirm: () => Promise<string>;
    dispose: () => Promise<void>;
  }) => void;
  let disposed = false;
  const challenge = new PhoneChallenge(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const pending = challenge.request("0901234567");
  await assert.rejects(challenge.request("0901234567"));
  await challenge.clear();
  resolve({
    confirm: async () => "secret-proof",
    dispose: async () => {
      disposed = true;
    },
  });
  await assert.rejects(pending, /Đã đóng/);
  assert.equal(disposed, true);
  assert.equal(challenge.verification, null);
});
test("does not retry a lost SMS response and honors provider throttling", async () => {
  let requests = 0;
  const challenge = new PhoneChallenge(
    async () => {
      requests++;
      throw { code: "auth/too-many-requests" };
    },
    () => 0,
  );
  await assert.rejects(challenge.request("0901234567"));
  assert.equal(challenge.seconds, 900);
  await assert.rejects(challenge.request("0901234567"));
  assert.equal(requests, 1);
});
test("uses only a live provider result and never persists or fabricates a proof", async () => {
  let now = 0;
  const challenge = new PhoneChallenge(
    async () => ({
      confirm: async (code) => {
        assert.equal(code, "123456");
        return "fixture-provider-proof";
      },
      dispose: async () => {},
    }),
    () => now,
  );
  await assert.rejects(challenge.confirm("123456"));
  await challenge.request("0901234567");
  await assert.rejects(challenge.confirm("123"));
  assert.equal(await challenge.confirm("123456"), "fixture-provider-proof");
  now = 300_000;
  await assert.rejects(challenge.confirm("123456"), /hết hạn/);
});
test("shows actionable errors without exposing raw Firebase diagnostics or credentials", () => {
  assert.match(
    phoneError({
      code: "auth/app-not-authorized",
      message: "secret-diagnostics",
    }),
    /SHA-1/,
  );
  assert.doesNotMatch(
    phoneError({ message: "private-token" }),
    /private-token/,
  );
  assert.match(phoneError(new PhoneAuthError("Build lại APK")), /Build lại/);
});
test("logout invalidates a late refresh and serializes deletion after a pending secure write", async () => {
  const gate = new SessionGate();
  const version = gate.version;
  let persisted: string | null = null,
    release!: () => void;
  const writing = gate.write(async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    persisted = "old-refresh";
  });
  await Promise.resolve();
  gate.next();
  const logout = gate.write(async () => {
    persisted = null;
  });
  release();
  await writing;
  await logout;
  assert.equal(gate.current(version), false);
  assert.equal(persisted, null);
});
test("build config keeps SMS off by default and refuses mismatched Firebase package", () => {
  const keys = [
    "EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED",
    "GOOGLE_SERVICES_JSON",
  ];
  const saved = keys.map((key) => process.env[key]);
  const folder = mkdtempSync(join(tmpdir(), "agritrace-firebase-config-"));
  const path = join(folder, "firebase-fixture.json");
  try {
    process.env.EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED = "false";
    assert.equal(
      configureApp({ config: {} } as never).extra?.phoneAuthEnabled,
      false,
    );
    process.env.EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED = "true";
    process.env.GOOGLE_SERVICES_JSON = path;
    writeFileSync(
      path,
      JSON.stringify({
        client: [
          {
            client_info: {
              android_client_info: { package_name: "dev.agritrace.consumer" },
            },
          },
        ],
      }),
    );
    assert.throws(
      () => configureApp({ config: {} } as never),
      /must match vn.agritrace.consumer/,
    );
    writeFileSync(
      path,
      JSON.stringify({
        client: [
          {
            client_info: {
              android_client_info: { package_name: "vn.agritrace.consumer" },
            },
          },
        ],
      }),
    );
    assert.equal(
      configureApp({ config: {} } as never).extra?.phoneAuthEnabled,
      true,
    );
  } finally {
    for (const [index, key] of keys.entries()) {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
