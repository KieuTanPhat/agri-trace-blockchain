import assert from "node:assert/strict";
import test from "node:test";
import {
  createMobileAuthApi,
  isConsumerProfile,
} from "../src/auth/mobile-auth-api";
import { SessionFailure } from "../src/auth/native-session";

const profile = {
  id: "11111111-1111-4111-8111-111111111111",
  phone: "+84900000000",
  fullName: "Fixture",
  province: "Hà Nội",
  ward: "Phường fixture",
};
const envelope = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data }));
test("native transport only calls native endpoints, omits cookies and never puts credentials in URL", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const api = createMobileAuthApi(
    "https://fixture.invalid/api",
    async (url, options) => {
      calls.push({ url: String(url), options });
      return envelope({
        sessionId: profile.id,
        accessToken: "jwt",
        tokenType: "Bearer",
        refreshToken: "r".repeat(64),
        refreshExpiresAt: new Date(Date.now() + 60000).toISOString(),
        user: profile,
      });
    },
  );
  await api.login({ phone: profile.phone, password: " password-exact " });
  assert.equal(calls[0].url, "https://fixture.invalid/api/auth/mobile/login");
  assert.equal(calls[0].options?.credentials, "omit");
  assert.equal(calls[0].options?.redirect, "error");
  assert.equal(
    JSON.parse(calls[0].options?.body as string).password,
    " password-exact ",
  );
});
test("private profile cannot contain role, email alias or password fields", () => {
  assert.equal(isConsumerProfile(profile), true);
  for (const key of ["role", "email", "passwordHash", "organizationId"])
    assert.equal(isConsumerProfile({ ...profile, [key]: "private" }), false);
});
test("401/409/503 errors stay sanitized, uncertain writes are never auto-retried and 429 cooldown is enforced", async () => {
  for (const status of [401, 409, 503, 429]) {
    let calls = 0;
    const api = createMobileAuthApi("https://fixture.invalid/api", async () => {
      calls++;
      return new Response("SECRET", {
        status,
        headers: { "Retry-After": "1" },
      });
    });
    await assert.rejects(
      api.login({ phone: profile.phone, password: "x" }),
      (error: unknown) =>
        error instanceof SessionFailure &&
        error.status === status &&
        !error.message.includes("SECRET"),
    );
    assert.equal(calls, 1);
    if (status === 429) {
      await assert.rejects(api.login({ phone: profile.phone, password: "x" }));
      assert.equal(calls, 1);
    }
  }
});
