import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { createCredentialStorage } from "../src/auth/credential-storage";
import {
  NativeSessionStore,
  SessionFailure,
  isRefreshCredential,
  type RefreshCredential,
  type NativeSession,
  type CredentialStorage,
  type NativeSessionApi,
} from "../src/auth/native-session";

const now = Date.parse("2026-10-19T10:00:00.000Z");
const profile = {
  id: "user-a",
  fullName: "Người thử A",
  phone: "+84900000000",
};
const session = (suffix = "1"): NativeSession => ({
  sessionId: "family-a",
  refreshToken: `refresh-${suffix}`,
  refreshExpiresAt: "2026-10-20T10:00:00.000Z",
  accessToken: `access-${suffix}`,
});
const credential = (suffix = "1"): RefreshCredential => {
  const s = session(suffix);
  return {
    sessionId: s.sessionId,
    refreshToken: s.refreshToken,
    refreshExpiresAt: s.refreshExpiresAt,
    state: "active",
  };
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture(initial: RefreshCredential | null = credential()) {
  let saved = initial;
  const order: string[] = [];
  const writes: RefreshCredential[] = [];
  const storage: CredentialStorage = {
    async read() {
      return saved && { ...saved };
    },
    async write(value) {
      writes.push({ ...value });
      order.push(`write:${value.state}`);
      saved = { ...value };
    },
    async clear() {
      order.push("clear");
      saved = null;
    },
  };
  const api: NativeSessionApi = {
    async refresh() {
      order.push("refresh");
      return session("2");
    },
    async me() {
      order.push("me");
      return profile;
    },
    async revoke() {
      order.push("revoke");
    },
  };
  const store = new NativeSessionStore(storage, api, () => now);
  return { store, api, storage, writes, order, saved: () => saved };
}

test("restore rotates, persists before me, and only then exposes the profile", async () => {
  const f = fixture();
  assert.equal(f.store.snapshot().status, "restoring");
  assert.equal(await f.store.restore(), true);
  assert.deepEqual(f.order, ["refresh", "write:active", "me"]);
  assert.deepEqual(f.store.snapshot().profile, profile);
  assert.equal(f.saved()?.refreshToken, "refresh-2");
  assert.deepEqual(Object.keys(f.saved()!).sort(), [
    "refreshExpiresAt",
    "refreshToken",
    "sessionId",
    "state",
  ]);
  assert.equal(JSON.stringify(f.saved()).includes("access-"), false);
});

test("concurrent refreshes share one promise and one rotation", async () => {
  const f = fixture();
  const hold = deferred<NativeSession>();
  let calls = 0;
  f.api.refresh = () => {
    calls++;
    return hold.promise;
  };
  const one = f.store.restore();
  const two = f.store.restore();
  assert.equal(one, two);
  hold.resolve(session("2"));
  assert.deepEqual(await Promise.all([one, two]), [true, true]);
  assert.equal(calls, 1);
});

test("offline before dispatch keeps credential but never shows cached private profile", async () => {
  const f = fixture();
  f.api.refresh = async () => {
    throw new SessionFailure("offline");
  };
  assert.equal(await f.store.restore(), false);
  assert.equal(f.store.snapshot().status, "temporarilyUnavailable");
  assert.equal(f.store.snapshot().profile, null);
  assert.equal(f.saved()?.state, "active");
  f.api.refresh = async () => session("2");
  assert.equal(await f.store.restore(), true);
});

test("refresh 401 deletes credential and requests a fresh login", async () => {
  const f = fixture();
  f.api.refresh = async () => {
    throw new SessionFailure("rejected", 401);
  };
  await f.store.restore();
  assert.equal(f.saved(), null);
  assert.equal(f.store.snapshot().status, "signedOut");
});

test("timeout/unknown response is not automatically rotated again", async () => {
  const f = fixture();
  let calls = 0;
  f.api.refresh = async () => {
    calls++;
    throw new SessionFailure("uncertain");
  };
  f.api.revoke = async () => {
    throw new SessionFailure("offline");
  };
  await f.store.restore();
  assert.equal(f.saved()?.state, "logoutPending");
  assert.equal(f.store.snapshot().status, "logoutPending");
  await f.store.restore();
  assert.equal(calls, 1);
});

test("409 recovers only from an already saved winner of the same family, once", async () => {
  const f = fixture();
  const tokens: string[] = [];
  f.api.refresh = async (token) => {
    tokens.push(token);
    if (tokens.length === 1) {
      await f.storage.write(credential("winner"));
      throw new SessionFailure("rejected", 409);
    }
    return session("3");
  };
  assert.equal(await f.store.restore(), true);
  assert.deepEqual(tokens, ["refresh-1", "refresh-winner"]);
  const missing = fixture();
  let calls = 0;
  missing.api.refresh = async () => {
    calls++;
    throw new SessionFailure("rejected", 409);
  };
  assert.equal(await missing.store.restore(), false);
  assert.equal(calls, 1);
  assert.equal(missing.store.snapshot().status, "signedOut");
});

test("logout durably marks pending before revoke; offline startup cannot restore pending", async () => {
  const f = fixture();
  await f.store.restore();
  f.order.length = 0;
  f.api.revoke = async () => {
    f.order.push("revoke");
    throw new SessionFailure("offline");
  };
  const logout = f.store.logout();
  assert.equal(f.store.snapshot().profile, null);
  assert.equal(f.store.snapshot().status, "logoutPending");
  assert.equal(await logout, false);
  assert.deepEqual(f.order, ["write:logoutPending", "revoke"]);
  const cold = new NativeSessionStore(f.storage, f.api, () => now);
  await cold.restore();
  assert.equal(cold.snapshot().status, "logoutPending");
  assert.equal(cold.snapshot().profile, null);
  f.api.revoke = async () => {};
  assert.equal(await cold.logout(), true);
  assert.equal(f.saved(), null);
});

test("logout intent survives a simulated crash on the FIRST UI notification, before async retirement starts", async () => {
  let raw: string | null = JSON.stringify(credential());
  let intent = false;
  let refreshes = 0;
  const storage = createCredentialStorage({
    available: async () => true,
    get: async () => raw,
    set: async value => { raw = value; },
    remove: async () => { raw = null; },
    logoutIntent: {
      mark: () => { intent = true; },
      read: () => intent,
      clear: async () => { intent = false; },
    },
  });
  const api: NativeSessionApi = {
    refresh: async () => { refreshes++; return session("rotated"); },
    me: async () => profile,
    revoke: async () => {},
  };
  const store = new NativeSessionStore(storage, api, () => now);
  await store.restore();
  store.subscribe(() => {
    if (store.snapshot().status === "logoutPending") {
      assert.equal(intent, true);
      throw new Error("simulated native mounting crash");
    }
  });
  assert.throws(() => store.logout(), /simulated native mounting crash/);
  assert.equal(JSON.parse(raw!).state, "active");
  const cold = new NativeSessionStore(storage, api, () => now);
  assert.equal(await cold.restore(), false);
  assert.equal(refreshes, 1, "cold start must not refresh the old active record");
  assert.equal(cold.snapshot().status, "logoutPending");
  assert.equal(cold.snapshot().profile, null);
  assert.equal(await cold.logout(), true);
  assert.equal(raw, null);
  assert.equal(intent, false);
});

test("durable logout intent overrides a late active write, and clears only after the credential", async () => {
  let raw: string | null = JSON.stringify(credential());
  let intent = false;
  const cleared: string[] = [];
  const storage = createCredentialStorage({
    available: async () => true,
    get: async () => raw,
    set: async value => { raw = value; },
    remove: async () => { cleared.push("credential"); raw = null; },
    logoutIntent: {
      mark: () => { intent = true; },
      read: () => intent,
      clear: async () => { cleared.push("intent"); intent = false; },
    },
  });
  storage.markLogoutIntent!();
  await storage.write(credential("late-rotation"));
  assert.equal((await storage.read())?.state, "logoutPending");
  await storage.clear();
  assert.deepEqual(cleared, ["credential", "intent"]);
  assert.equal(raw, null);
  assert.equal(intent, false);
});

test("failure to persist logout intent never reports success when normal retirement also fails", async () => {
  const f = fixture();
  await f.store.restore();
  f.storage.markLogoutIntent = () => { throw new Error("sync storage failed"); };
  f.storage.write = async () => { throw new Error("async storage failed"); };
  assert.equal(await f.store.logout(), false);
  assert.equal(f.store.snapshot().status, "logoutPending");
  assert.match(f.store.snapshot().message, /có thể còn hoạt động/);
});

test("logout during refresh revokes the ROTATED token, not just its stale predecessor", async () => {
  const f = fixture();
  const started = deferred<void>();
  const hold = deferred<NativeSession>();
  const revoked: string[] = [];
  f.api.refresh = () => {
    started.resolve();
    return hold.promise;
  };
  f.api.revoke = async (token) => {
    revoked.push(token);
  };
  const restoring = f.store.restore();
  await started.promise;
  const loggingOut = f.store.logout();
  assert.equal(f.store.snapshot().profile, null);
  hold.resolve(session("rotated"));
  assert.equal(await restoring, false);
  assert.equal(await loggingOut, true);
  assert.deepEqual(revoked, ["refresh-rotated"]);
  assert.equal(f.saved(), null);
  assert.equal(f.store.snapshot().status, "signedOut");
});

test("rotated token storage failure never opens account and tries revoking new token", async () => {
  const f = fixture();
  const revoked: string[] = [];
  f.storage.write = async () => {
    throw new Error("Keychain unavailable");
  };
  f.api.revoke = async (token) => {
    revoked.push(token);
  };
  assert.equal(await f.store.restore(), false);
  assert.ok(revoked.includes("refresh-2"));
  assert.equal(f.order.includes("me"), false);
  assert.equal(f.store.snapshot().profile, null);
  assert.equal(f.store.snapshot().status, "temporarilyUnavailable");
});

test("logout storage failure blocks refresh and reports that server revocation is uncertain", async () => {
  const f = fixture();
  await f.store.restore();
  f.storage.write = async () => {
    throw new Error("Keychain unavailable");
  };
  assert.equal(await f.store.logout(), false);
  assert.equal(f.store.snapshot().status, "logoutPending");
  assert.match(f.store.snapshot().message, /có thể còn hoạt động/);
  assert.equal(await f.store.restore(), false);
});

test("switching account clears old profile immediately and never accepts late GET data", async () => {
  const f = fixture();
  await f.store.restore();
  const old = deferred<string>();
  const read = f.store.privateGet(async () => old.promise);
  const rejected = assert.rejects(read, SessionFailure);
  const login = f.store.authenticate(async () => ({
    ...session("b"),
    sessionId: "family-b",
  }));
  assert.equal(f.store.snapshot().profile, null);
  f.api.me = async () => ({
    ...profile,
    id: "user-b",
    fullName: "Người thử B",
  });
  assert.equal(await login, true);
  old.resolve("private-data-a");
  await rejected;
  assert.equal(f.store.snapshot().profile?.id, "user-b");
});

test("private GET 401 refreshes once and retries once; 403 and second 401 are not retried", async () => {
  const f = fixture();
  await f.store.restore();
  const seen: string[] = [];
  assert.equal(
    await f.store.privateGet(async (token) => {
      seen.push(token);
      if (seen.length === 1) throw new SessionFailure("rejected", 401);
      return "ok";
    }),
    "ok",
  );
  assert.equal(seen.length, 2);
  let forbidden = 0;
  await assert.rejects(
    f.store.privateGet(async () => {
      forbidden++;
      throw new SessionFailure("rejected", 403);
    }),
  );
  assert.equal(forbidden, 1);
  let unauthorized = 0;
  await assert.rejects(
    f.store.privateGet(async () => {
      unauthorized++;
      throw new SessionFailure("rejected", 401);
    }),
  );
  assert.equal(unauthorized, 2);
});

test("new auth waits for restore and duplicate submit is refused", async () => {
  const f = fixture(null);
  let calls = 0;
  const login = async () => {
    calls++;
    return session();
  };
  assert.equal(await f.store.authenticate(login), false);
  await f.store.restore();
  const one = f.store.authenticate(login);
  assert.equal(await f.store.authenticate(login), false);
  assert.equal(await one, true);
  assert.equal(calls, 1);
});

test("me rejection never exposes session response profile or keeps invalid credential", async () => {
  const f = fixture();
  f.api.me = async () => {
    throw new SessionFailure("rejected", 401);
  };
  assert.equal(await f.store.restore(), false);
  assert.equal(f.store.snapshot().profile, null);
  assert.equal(f.saved(), null);
});

test("strict persisted shape rejects accessToken, PII, unknown state, huge token, invalid dates", () => {
  assert.equal(isRefreshCredential(credential()), true);
  for (const extra of [
    { accessToken: "jwt" },
    { password: "secret" },
    { profile },
  ]) {
    assert.equal(isRefreshCredential({ ...credential(), ...extra }), false);
  }
  assert.equal(
    isRefreshCredential({ ...credential(), state: "unknown" }),
    false,
  );
  assert.equal(
    isRefreshCredential({ ...credential(), refreshToken: "a".repeat(1025) }),
    false,
  );
  assert.equal(
    isRefreshCredential({ ...credential(), refreshExpiresAt: "2026-02-31" }),
    false,
  );
});

test("native storage has no browser/AsyncStorage fallback and Android backup plugin is enabled", () => {
  const source = readFileSync(
    new URL("../src/auth/secure-credential-storage.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /WHEN_UNLOCKED_THIS_DEVICE_ONLY/);
  assert.match(source, /Platform.OS !== "web"/);
  assert.doesNotMatch(source, /from ["'].*async-storage|localStorage\./);
  const config = readFileSync(
    new URL("../app.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    config,
    /"expo-secure-store", \{ configureAndroidBackup: true \}/,
  );
});

test("secure serializer round trips exact credential only and propagates native failures", async () => {
  let raw: string | null = null;
  const storage = createCredentialStorage({
    available: async () => true,
    get: async () => raw,
    set: async (value) => {
      raw = value;
    },
    remove: async () => {
      raw = null;
    },
  });
  assert.equal(await storage.read(), null);
  await storage.write(credential());
  assert.deepEqual(await storage.read(), credential());
  await assert.rejects(
    storage.write({
      ...credential(),
      accessToken: "secret",
    } as RefreshCredential),
  );
  raw = "private-token-not-valid-json";
  await assert.rejects(
    storage.read(),
    (error: Error) => !error.message.includes("private-token"),
  );
  raw = JSON.stringify({ ...credential(), profile });
  await assert.rejects(storage.read());
  await storage.clear();
  assert.equal(raw, null);
  const unavailable = createCredentialStorage({
    available: async () => false,
    get: async () => {
      throw new Error("must not read");
    },
    set: async () => {
      throw new Error("must not write");
    },
    remove: async () => {
      throw new Error("must not delete");
    },
  });
  await assert.rejects(unavailable.read(), /Kho bảo mật/);
  await assert.rejects(unavailable.write(credential()), /Kho bảo mật/);
  await assert.rejects(unavailable.clear(), /Kho bảo mật/);
});

test("expired records do not refresh and corrupted storage does not authenticate", async () => {
  const f = fixture({
    ...credential(),
    refreshExpiresAt: "2026-10-18T00:00:00.000Z",
  });
  await f.store.restore();
  assert.deepEqual(f.order, ["clear"]);
  assert.equal(f.store.snapshot().status, "signedOut");
  f.storage.read = async () => {
    throw new Error("Native key unavailable");
  };
  assert.equal(await f.store.restore(), false);
  assert.equal(f.store.snapshot().status, "temporarilyUnavailable");
  assert.equal(f.store.snapshot().profile, null);
});

test("two private 401s share a single refresh", async () => {
  const f = fixture();
  await f.store.restore();
  const hold = deferred<NativeSession>();
  let refreshCalls = 0;
  f.api.refresh = () => {
    refreshCalls++;
    return hold.promise;
  };
  let calls = 0;
  const request = async () => {
    if (++calls <= 2) throw new SessionFailure("rejected", 401);
    return "ok";
  };
  const one = f.store.privateGet(request);
  const two = f.store.privateGet(request);
  hold.resolve(session("3"));
  assert.deepEqual(await Promise.all([one, two]), ["ok", "ok"]);
  assert.equal(refreshCalls, 1);
});

test("logout followed by B login never lets late A profile replace B", async () => {
  const f = fixture(null);
  await f.store.restore();
  const hold = deferred<NativeSession>();
  const started = deferred<void>();
  const oldLogin = f.store.authenticate(async () => {
    started.resolve();
    return hold.promise;
  });
  await started.promise;
  const logout = f.store.logout();
  f.api.me = async () => ({ ...profile, id: "user-b" });
  const newLogin = f.store.authenticate(async () => ({
    ...session("b"),
    sessionId: "family-b",
  }));
  hold.resolve(session("a"));
  assert.equal(await oldLogin, false);
  await logout;
  assert.equal(await newLogin, true);
  assert.equal(f.saved()?.sessionId, "family-b");
  assert.equal(f.store.snapshot().profile?.id, "user-b");
});
