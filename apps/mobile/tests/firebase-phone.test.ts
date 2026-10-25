import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import {
  createFirebasePhoneVerifier,
  phoneError,
  signOutFirebaseIfPresent,
  type PhoneSdk,
} from "../src/auth/firebase-phone-core";

test("already-signed-out Firebase is an idempotent cleanup, not a failed SMS precondition", async () => {
  let sends = 0;
  const verifier = createFirebasePhoneVerifier({
    signOut: () => signOutFirebaseIfPresent(async () => {
      throw { code: "auth/no-current-user" };
    }),
    async send() {
      sends++;
      return { async confirm() { return "fresh-id-token"; } };
    },
  });
  const signal = new AbortController().signal;
  const challenge = await verifier.send("+84900000000", signal);
  assert.equal(sends, 1);
  assert.equal(await verifier.confirm(challenge.challengeId, "123456", signal), "fresh-id-token");
  for (const cause of [{ code: "auth/network-request-failed" }, new Error("native module failed"), { code: "no-current-user" }]) {
    await assert.rejects(signOutFirebaseIfPresent(async () => { throw cause; }), error => error === cause);
  }
});

test("phone diagnostics expose only allowlisted codes, not SDK messages or arbitrary codes", () => {
  for (const code of ["auth/invalid-app-credential", "auth/internal-error", "auth/missing-client-identifier", "app/no-app", "auth/operation-not-allowed"]) {
    const message = phoneError({ code, message: "PRIVATE_PHONE_TOKEN" }).message;
    assert.ok(message.includes(`[${code}]`));
    assert.ok(!message.includes("PRIVATE_PHONE_TOKEN"));
  }
  assert.ok(phoneError({ code: "PRIVATE_PHONE_TOKEN" }).message.includes("PHONE-UNCLASSIFIED"));
  assert.ok(!phoneError({ code: "PRIVATE_PHONE_TOKEN" }).message.includes("PRIVATE_PHONE_TOKEN"));
  assert.ok(phoneError({ code: "toString" }).message.includes("PHONE-UNCLASSIFIED"));
  for (const code of ["auth/web-context-cancelled", "auth/error-code:-39", "auth/new-sdk-error"]) {
    const message = phoneError({ code, message: "PRIVATE_PHONE_TOKEN" }).message;
    assert.ok(message.includes(`[${code}]`));
    assert.ok(!message.includes("PRIVATE_PHONE_TOKEN"));
  }
  for (const code of ["auth/private_123456", "auth/https://private", `auth/${"x".repeat(100)}`]) {
    assert.ok(phoneError({ code }).message.includes("PHONE-UNCLASSIFIED"));
  }
});

test("local initialization/sign-out failures identify the step without dispatching SMS", async () => {
  let sends = 0;
  const verifier = createFirebasePhoneVerifier({
    async signOut() {
      throw new TypeError("PRIVATE_NATIVE_METHOD is not a function PRIVATE_PHONE_TOKEN");
    },
    async send() {
      sends++;
      throw new Error("must not send");
    },
  });
  await assert.rejects(
    verifier.send("+84900000000", new AbortController().signal),
    (cause: Error) => {
      assert.ok(cause.message.includes("SIGNOUT_BEFORE_SMS/MISSING-METHOD"));
      assert.ok(!cause.message.includes("PRIVATE"));
      return true;
    },
  );
  assert.equal(sends, 0);
  assert.ok(phoneError(new Error("No Firebase App '[DEFAULT]' has been created")).message.includes("NO-DEFAULT-APP"));
  assert.ok(phoneError(new Error("signInWithPhoneNumber() did not return a verificationId.")).message.includes("NO-VERIFICATION-ID"));
});

test("native Firebase adapter imports a distinct core basename to avoid Metro native self-resolution", () => {
  const adapter = new URL("../src/auth/firebase-phone.native.ts", import.meta.url);
  const source = readFileSync(adapter, "utf8");
  assert.match(source, /from ["']\.\/firebase-phone-core["']/);
  assert.doesNotMatch(source, /from ["']\.\/firebase-phone["']/);
  assert.ok(existsSync(new URL("../src/auth/firebase-phone-core.ts", import.meta.url)));
  assert.ok(!existsSync(new URL("../src/auth/firebase-phone-core.native.ts", import.meta.url)));
});

test("Firebase adapter sends normalized phone only and signs out immediately after acquiring a token", async () => {
  const calls: string[] = [];
  const sdk: PhoneSdk = {
    async send(phone) {
      calls.push(phone);
      return {
        async confirm(code) {
          calls.push(code);
          return "id-token-memory-only";
        },
      };
    },
    async signOut() {
      calls.push("signOut");
    },
  };
  const verifier = createFirebasePhoneVerifier(sdk);
  const signal = new AbortController().signal;
  const challenge = await verifier.send("+84900000000", signal);
  assert.equal(
    await verifier.confirm(challenge.challengeId, "123456", signal),
    "id-token-memory-only",
  );
  assert.deepEqual(calls, [
    "signOut",
    "+84900000000",
    "signOut",
    "123456",
    "signOut",
  ]);
  await assert.rejects(
    verifier.confirm(challenge.challengeId, "123456", signal),
  );
  await assert.rejects(verifier.send("+84900000000", signal));
});
test("a cancelled native send cannot restore a challenge and a failed SMS request still reserves its cooldown", async () => {
  let finish!: (value: Awaited<ReturnType<PhoneSdk["send"]>>) => void;
  let sent = 0;
  const verifier = createFirebasePhoneVerifier({
    send: () => {
      sent++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
    async signOut() {},
  });
  const controller = new AbortController();
  const pending = verifier.send("+84900000000", controller.signal);
  await Promise.resolve();
  controller.abort();
  verifier.cancel?.();
  finish({
    async confirm() {
      return "late";
    },
  });
  await assert.rejects(pending);
  await assert.rejects(
    verifier.send("+84900000000", new AbortController().signal),
  );
  assert.equal(sent, 1);
});
test("rejects nonnormalized phone, expires challenges and never exposes raw Firebase errors", async () => {
  let now = 0;
  const verifier = createFirebasePhoneVerifier(
    {
      async send() {
        return {
          async confirm() {
            throw {
              code: "auth/invalid-verification-code",
              message: "PRIVATE",
            };
          },
        };
      },
      async signOut() {},
    },
    () => now,
  );
  const signal = new AbortController().signal;
  await assert.rejects(verifier.send("0900000000", signal));
  const challenge = await verifier.send("+84900000000", signal);
  await assert.rejects(
    verifier.confirm(challenge.challengeId, "123456", signal),
    /Mã OTP chưa đúng/,
  );
  now = 300_001;
  await assert.rejects(
    verifier.confirm(challenge.challengeId, "123456", signal),
    /hết hạn/,
  );
  assert.ok(
    !phoneError({ message: "PRIVATE", code: "unknown" }).message.includes(
      "PRIVATE",
    ),
  );
});
