import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createMockAuthServices } from "../src/auth/mock-service";
import { PREVIEW_CONSENT_VERSION } from "../src/auth/legal-preview";
import { provinces, filterLocations, findLocation } from "../src/locations";
import {
  changeProvince,
  credentialErrors,
  emptyRegistration,
  profileErrors,
} from "../src/auth/registration-validation";
import { DemoSessionStore } from "../src/auth/session-store";

const signal = () => new AbortController().signal;
const phone = "+84900000000";
const input = () => ({
  phone,
  password: "Temporary-only-123",
  fullName: "Người dùng thử",
  provinceCode: provinces[0].code,
  wardCode: provinces[0].wards[0].code,
  consentVersion: PREVIEW_CONSENT_VERSION,
  phoneProof: "",
});

test("mobile/API location copies have identical revision, hash, codes and build-time Vietnamese ordering", async () => {
  const mobile = await readFile(
    new URL("../src/locations/vietnam.json", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../../api/src/common/locations/vietnam.json", import.meta.url),
    "utf8",
  );
  assert.equal(mobile, api);
  const data = JSON.parse(mobile);
  assert.equal(
    createHash("sha256").update(JSON.stringify(data.provinces)).digest("hex"),
    data.sha256,
  );
  const compare = (
    a: { name: string; code: string },
    b: { name: string; code: string },
  ) => a.name.localeCompare(b.name, "vi") || a.code.localeCompare(b.code);
  assert.deepEqual(provinces, [...provinces].sort(compare));
  assert.equal(new Set(provinces.map((p) => p.code)).size, provinces.length);
  const wards = provinces.flatMap((p) => p.wards);
  assert.equal(new Set(wards.map((w) => w.code)).size, wards.length);
  for (const p of provinces)
    assert.deepEqual(p.wards, [...p.wards].sort(compare));
});
test("location selection enforces parent, supports accent-insensitive search and clears ward on changing province", () => {
  const p = provinces[0],
    w = p.wards[0];
  assert.ok(findLocation(p.code, w.code));
  assert.equal(findLocation(provinces[1].code, w.code), null);
  assert.ok(
    filterLocations(provinces, "ha noi").some((item) => item.name === "Hà Nội"),
  );
  const draft = {
    ...emptyRegistration(),
    provinceCode: p.code,
    wardCode: w.code,
  };
  assert.equal(changeProvince(draft, p.code).wardCode, w.code);
  assert.equal(changeProvince(draft, provinces[1].code).wardCode, "");
});
test("registration requires matching credentials, full name, location and affirmative consent", () => {
  assert.ok(Object.values(credentialErrors(emptyRegistration())).some(Boolean));
  const valid = {
    ...emptyRegistration(),
    phone: "0900000000",
    password: "Temporary-only-123",
    confirmation: "Temporary-only-123",
    fullName: "Test",
    provinceCode: provinces[0].code,
    wardCode: provinces[0].wards[0].code,
    consent: true,
  };
  assert.ok(Object.values(credentialErrors(valid)).every((item) => !item));
  assert.ok(Object.values(profileErrors(valid)).every((item) => !item));
  assert.ok(profileErrors({ ...valid, consent: false }).consent);
  assert.ok(
    profileErrors({ ...valid, contactEmail: "not-email" }).contactEmail,
  );
  assert.ok(
    credentialErrors({ ...valid, confirmation: "different" }).confirmation,
  );
});
test("mock OTP enforces resend cooldown, invalidates old challenges and blocks expired codes", async () => {
  let now = 100_000;
  const { phone: verifier } = createMockAuthServices(() => now);
  const first = await verifier.send(phone, signal());
  await assert.rejects(verifier.send(phone, signal()));
  await assert.rejects(verifier.confirm(first.challengeId, "wrong", signal()));
  now += 30_001;
  const second = await verifier.send(phone, signal());
  await assert.rejects(verifier.confirm(first.challengeId, "123456", signal()));
  now += 300_001;
  await assert.rejects(
    verifier.confirm(second.challengeId, "123456", signal()),
  );
});
test("OTP max attempts and cancellation do not accidentally accept a verification", async () => {
  const { phone: verifier } = createMockAuthServices();
  const challenge = await verifier.send(phone, signal());
  for (let attempt = 0; attempt < 5; attempt++)
    await assert.rejects(
      verifier.confirm(challenge.challengeId, "000000", signal()),
    );
  await assert.rejects(
    verifier.confirm(challenge.challengeId, "123456", signal()),
  );
  await assert.rejects(verifier.send("+84910000000", AbortSignal.abort()));
});
test("register uses a phone-bound, one-use proof and returns no password or verification token", async () => {
  const { phone: verifier, auth } = createMockAuthServices();
  const challenge = await verifier.send(phone, signal());
  const proof = await verifier.confirm(
    challenge.challengeId,
    "123456",
    signal(),
  );
  await assert.rejects(
    auth.register!(
      { ...input(), phone: "+84910000000", phoneProof: proof },
      signal(),
    ),
  );
  const store = new DemoSessionStore(auth);
  assert.equal(await store.register({ ...input(), phoneProof: proof }), true);
  const serialized = JSON.stringify(store.snapshot());
  assert.ok(!serialized.includes("Temporary-only-123"));
  assert.ok(!serialized.includes(proof));
  assert.equal(store.snapshot().profile?.province, provinces[0].label);
  await assert.rejects(
    auth.register!({ ...input(), phoneProof: proof }, signal()),
  );
});
test("reset requires verification, does not create a session and leaves fixed demo credentials unchanged", async () => {
  const { phone: verifier, auth } = createMockAuthServices();
  await assert.rejects(
    auth.resetPassword!(
      { phone, password: "Replacement-123", phoneProof: "bad" },
      signal(),
    ),
  );
  const challenge = await verifier.send(phone, signal());
  const proof = await verifier.confirm(
    challenge.challengeId,
    "123456",
    signal(),
  );
  await auth.resetPassword!(
    { phone, password: "Replacement-123", phoneProof: proof },
    signal(),
  );
  await assert.rejects(
    auth.resetPassword!(
      { phone, password: "Replacement-123", phoneProof: proof },
      signal(),
    ),
  );
  assert.equal(
    (await auth.login({ phone, password: "Demo-only-1234" }, signal())).phone,
    phone,
  );
});
