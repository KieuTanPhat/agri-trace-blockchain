import { beforeEach, expect, it, vi } from "vitest";
import { PhoneChallenge } from "../../mobile/src/auth/phone-challenge";

type Snapshot = { state: string; verificationId: string | null; code: string | null; error: unknown };
const phone = "+84908521445";
const mock = vi.hoisted(() => ({
  callbacks: [] as Array<(snapshot: Snapshot) => void>,
  auth: { currentUser: null as null | { phoneNumber: string } },
  verify: vi.fn(), credential: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), token: vi.fn(),
}));
vi.mock("../../mobile/node_modules/expo-constants", () => ({ default: { expoConfig: { extra: { phoneAuthEnabled: true } } } }));
vi.mock("../../mobile/node_modules/@react-native-firebase/auth", () => ({
  getAuth: () => mock.auth,
  verifyPhoneNumber: mock.verify,
  PhoneAuthProvider: { credential: mock.credential },
  signInWithCredential: mock.signIn,
  signOut: mock.signOut,
  getIdToken: mock.token,
}));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mock.callbacks.length = 0; mock.auth.currentUser = null;
  mock.verify.mockImplementation(() => ({ on: (_: string, callback: (snapshot: Snapshot) => void) => { mock.callbacks.push(callback); } }));
  mock.credential.mockImplementation((verificationId: string, code: string) => ({ verificationId, code }));
  mock.signIn.mockResolvedValue({ user: { phoneNumber: phone } });
  mock.signOut.mockImplementation(async () => { mock.auth.currentUser = null; });
  mock.token.mockResolvedValue("fixture-firebase-proof");
});
const snapshot = (state: string, verificationId: string | null = "request-id", code: string | null = null): Snapshot => ({ state, verificationId, code, error: null });
async function start(forceResend = false) {
  const { requestPhoneVerification } = await import("../../mobile/src/auth/firebase-phone.native");
  const pending = requestPhoneVerification(phone, forceResend);
  await vi.waitFor(() => expect(mock.callbacks).toHaveLength(1));
  mock.callbacks[0](snapshot("sent"));
  return pending;
}
it("auto-verification leaves final account submission to the user's confirmation", async () => {
  const verification = await start();
  mock.callbacks[0](snapshot("verified", "automatic-id", "123456"));
  expect(verification.automaticallyVerified).toBe(true);
  expect(mock.signIn).not.toHaveBeenCalled();
  expect(await verification.confirm("")).toBe("fixture-firebase-proof");
  expect(mock.credential).toHaveBeenCalledWith("automatic-id", "123456");
  expect(mock.signIn).toHaveBeenCalledTimes(1);
});
it("auto-retrieval timeout still permits manual OTP entry", async () => {
  const verification = await start();
  mock.callbacks[0](snapshot("timeout"));
  expect(verification.automaticallyVerified).toBe(false);
  await expect(verification.confirm("123456")).resolves.toBe("fixture-firebase-proof");
  expect(mock.credential).toHaveBeenCalledWith("request-id", "123456");
});
it("instant verification preserves RNFB's cached native credential path", async () => {
  const { requestPhoneVerification } = await import("../../mobile/src/auth/firebase-phone.native");
  const pending = requestPhoneVerification(phone);
  await vi.waitFor(() => expect(mock.callbacks).toHaveLength(1));
  mock.callbacks[0](snapshot("verified", null));
  const verification = await pending;
  await verification.confirm("");
  expect(mock.credential).toHaveBeenCalledWith(null, "");
});
it("explicit resend passes the native force-resend option", async () => {
  await start(true);
  expect(mock.verify).toHaveBeenCalledWith(mock.auth, phone, 60, true);
});
it("closing an older verification cannot sign out or confirm a newer attempt", async () => {
  const old = await start();
  const { requestPhoneVerification } = await import("../../mobile/src/auth/firebase-phone.native");
  const pending = requestPhoneVerification(phone, true);
  await vi.waitFor(() => expect(mock.callbacks).toHaveLength(2));
  mock.callbacks[1](snapshot("sent", "new-request"));
  const current = await pending;
  mock.auth.currentUser = { phoneNumber: phone };
  await old.dispose();
  expect(mock.signOut).not.toHaveBeenCalled();
  await expect(old.confirm("123456")).rejects.toThrow("Đã đóng phiên xác minh");
  mock.callbacks[0](snapshot("verified", "old-request", "654321"));
  expect(current.automaticallyVerified).toBe(false);
  await current.confirm("123456");
  expect(mock.credential).toHaveBeenLastCalledWith("new-request", "123456");
});
it("a Firebase credential for a different phone never becomes an API proof", async () => {
  const verification = await start();
  mock.signIn.mockResolvedValue({ user: { phoneNumber: "+84912345678" } });
  await expect(verification.confirm("123456")).rejects.toThrow("chưa xác minh đúng số");
  expect(mock.token).not.toHaveBeenCalled();
});
it("Back invalidates the old phone and preserves cooldown before a new request", async () => {
  let now = 1000;
  const verification = { confirm: vi.fn().mockResolvedValue("proof"), dispose: vi.fn().mockResolvedValue(undefined) };
  const send = vi.fn().mockResolvedValue(verification);
  const challenge = new PhoneChallenge(send, () => now);
  await challenge.request("0908521445");
  await challenge.clear();
  await expect(challenge.confirm("123456")).rejects.toThrow("hết hạn");
  await expect(challenge.request("0912345678")).rejects.toThrow("Chờ hết bộ đếm");
  now += 60_001;
  await challenge.request("0912345678");
  expect(challenge.phone).toBe("+84912345678");
  expect(send).toHaveBeenLastCalledWith("+84912345678", false);
  now += 60_001;
  await challenge.request("0912345678");
  expect(send).toHaveBeenLastCalledWith("+84912345678", true);
});
it("closing while a request is pending rejects its late verification", async () => {
  let finish!: (value: { confirm: () => Promise<string>; dispose: () => Promise<void> }) => void;
  const send = vi.fn(() => new Promise<{ confirm: () => Promise<string>; dispose: () => Promise<void> }>(resolve => { finish = resolve; }));
  const challenge = new PhoneChallenge(send);
  const pending = challenge.request("0908521445");
  await vi.waitFor(() => expect(send).toHaveBeenCalled());
  await challenge.clear();
  const dispose = vi.fn().mockResolvedValue(undefined);
  finish({ confirm: async () => "old-proof", dispose });
  await expect(pending).rejects.toThrow("Đã đóng phiên xác minh");
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(challenge.verification).toBe(null);
});
