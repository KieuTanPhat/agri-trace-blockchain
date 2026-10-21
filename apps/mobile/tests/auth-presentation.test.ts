import assert from "node:assert/strict";
import { test } from "node:test";
import { authPresentation } from "../src/auth/auth-presentation";
import { mobileLayout } from "../src/theme/layout";

test("registration shows credentials/profile/OTP in the existing order", () => {
  for (const [step, current] of [
    ["credentials", 0],
    ["profile", 1],
    ["otp", 2],
  ] as const) {
    const view = authPresentation("register", step);
    assert.equal(view.current, current);
    assert.deepEqual(view.steps, ["Tài khoản", "Hồ sơ", "Xác nhận"]);
    assert.ok(view.title.length && view.subtitle.length);
  }
});
test("password reset shows phone/OTP/new-password without inventing a real session", () => {
  for (const [step, current] of [
    ["credentials", 0],
    ["otp", 1],
    ["password", 2],
    ["done", 2],
  ] as const) {
    assert.equal(authPresentation("reset", step).current, current);
  }
  assert.match(authPresentation("reset", "done").title, /bản thử/);
  assert.match(authPresentation("reset", "credentials").title, /Quên mật khẩu/);
});
test("three guide cards fall back to readable rows on narrow screens/large type", () => {
  assert.equal(mobileLayout(320).stepsHorizontal, false);
  assert.equal(mobileLayout(390).stepsHorizontal, true);
  assert.equal(mobileLayout(390, 1.5).stepsHorizontal, false);
});
