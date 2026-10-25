import assert from "node:assert/strict";
import test from "node:test";
import {
  authDemoEnabled,
  type AuthService,
  type ConsumerProfile,
} from "../src/auth/types";
import {
  normalizePhone,
  passwordError,
  utf8Bytes,
  validateLogin,
} from "../src/auth/validation";
import { createMockAuthService } from "../src/auth/mock-service";
import { DemoSessionStore } from "../src/auth/session-store";

test("demo requires both development mode and an explicit opt-in", () => {
  for (const flag of ["true", "false", "", undefined])
    assert.equal(authDemoEnabled(false, flag), false);
  assert.equal(authDemoEnabled(true, undefined), false);
  assert.equal(authDemoEnabled(true, "TRUE"), false);
  assert.equal(authDemoEnabled(true, "true"), true);
});
test("normalizes phone shape without claiming to verify ownership", () => {
  assert.equal(normalizePhone(" 0900000000 "), "+84900000000");
  assert.equal(normalizePhone("+84900000000"), "+84900000000");
  for (const invalid of [
    "090000000",
    "090 000 0000",
    "+1 1234567890",
    "0900000000x",
    "",
  ])
    assert.equal(normalizePhone(invalid), null);
});
test("UTF-8 registration checks do not trim, truncate or normalize passwords", () => {
  for (const value of ["ASCII", "ậ".repeat(24), "😀".repeat(18), "\ud800"]) {
    assert.equal(utf8Bytes(value), Buffer.byteLength(value, "utf8"));
  }
  assert.equal(passwordError("ậ".repeat(24)), undefined);
  assert.ok(passwordError("ậ".repeat(25)));
  assert.ok(passwordError("too-short"));
  assert.equal(passwordError(" ".repeat(12)), undefined);
  assert.equal(passwordError("😀".repeat(18)), undefined);
  assert.ok(passwordError("😀".repeat(19)));
  assert.equal(validateLogin("0900000000", "short").password, undefined);
  assert.ok(validateLogin("bad", "").phone);
});
test("mock only accepts synthetic credentials and cannot call any API", async () => {
  const service = createMockAuthService();
  await assert.rejects(
    service.login(
      { phone: "+84900000000", password: "incorrect" },
      new AbortController().signal,
    ),
  );
  const profile = await service.login(
    { phone: "+84900000000", password: "Demo-only-1234" },
    new AbortController().signal,
  );
  assert.deepEqual(Object.keys(profile).sort(), ["fullName", "id", "phone"]);
  await assert.rejects(
    service.login(
      { phone: profile.phone, password: "Demo-only-1234" },
      AbortSignal.abort(),
    ),
  );
});
test("logout/cancel prevent a late login response from restoring the old profile", async () => {
  for (const action of ["logout", "cancel"] as const) {
    let finish!: (profile: ConsumerProfile) => void;
    let calls = 0;
    const service: AuthService = {
      login: () => {
        calls++;
        return new Promise((resolve) => {
          finish = resolve;
        });
      },
      logout: async () => {},
    };
    const store = new DemoSessionStore(service);
    const pending = store.login("+84900000000", "secret-in-memory");
    assert.equal(await store.login("+84900000000", "second"), false);
    assert.equal(calls, 1);
    if (action === "logout") await store.logout();
    else store.cancelLogin();
    finish({ id: "old", phone: "+84900000000", fullName: "old" });
    assert.equal(await pending, false);
    assert.equal(store.snapshot().status, "signedOut");
    assert.equal(store.snapshot().profile, null);
    assert.ok(!JSON.stringify(store.snapshot()).includes("secret-in-memory"));
  }
});
test("disabled auth cannot start a session; errors do not reveal service internals", async () => {
  const disabled = new DemoSessionStore(null);
  assert.equal(await disabled.login("anything", "anything"), false);
  const store = new DemoSessionStore({
    login: async () => {
      throw new Error("PRIVATE-SERVER-DETAIL");
    },
    logout: async () => {},
  });
  assert.equal(await store.login("test", "password"), false);
  assert.equal(store.snapshot().status, "signedOut");
  assert.ok(!store.snapshot().error.includes("PRIVATE-SERVER-DETAIL"));
});

test("switching account retains B when the earlier A response arrives last", async () => {
  const resolveLogin: Array<(profile: ConsumerProfile) => void> = [];
  const service: AuthService = {
    login: () => new Promise((resolve) => resolveLogin.push(resolve)),
    logout: async () => {},
  };
  const store = new DemoSessionStore(service);
  const a = store.login("A", "a");
  await store.logout();
  const b = store.login("B", "b");
  resolveLogin[1]({ id: "B", fullName: "B", phone: "B" });
  assert.equal(await b, true);
  resolveLogin[0]({ id: "A", fullName: "A", phone: "A" });
  assert.equal(await a, false);
  assert.equal(store.snapshot().profile?.id, "B");
});
