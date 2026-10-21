import type { PhoneVerifier } from "./types";
import { normalizePhone } from "./validation";

export interface PhoneSdk {
  send(phone: string): Promise<{ confirm(code: string): Promise<string> }>;
  signOut(): Promise<void>;
}
/** Android RNFirebase can reject signOut when already signed out. Only this
 * precise SDK code is a successful no-op; never swallow transport/config errors.
 */
export async function signOutFirebaseIfPresent(
  signOut: () => Promise<void>,
): Promise<void> {
  try {
    await signOut();
  } catch (cause) {
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "auth/no-current-user"
    ) return;
    throw cause;
  }
}
type PhoneStep = "VERIFY" | "SIGNOUT_BEFORE_SMS" | "SEND_SMS" | "SIGNOUT_AFTER_SMS";
export function phoneError(cause: unknown, step: PhoneStep = "VERIFY"): Error {
  const code =
    cause && typeof cause === "object" && "code" in cause ? cause.code : "";
  const messages: Record<string, string> = {
    "auth/invalid-verification-code":
      "Mã OTP chưa đúng. Vui lòng kiểm tra lại.",
    "auth/session-expired": "Mã xác nhận đã hết hạn. Vui lòng gửi lại.",
    "auth/code-expired": "Mã xác nhận đã hết hạn. Vui lòng gửi lại.",
    "auth/too-many-requests":
      "Đã thử quá nhiều lần. Vui lòng chờ trước khi gửi lại.",
    "auth/quota-exceeded": "Dịch vụ SMS đã đạt hạn mức. Vui lòng thử lại sau.",
    "auth/invalid-phone-number": "Số điện thoại chưa hợp lệ.",
    "auth/network-request-failed":
      "Không kết nối được dịch vụ SMS. Kiểm tra mạng rồi thử lại.",
    "auth/app-not-authorized":
      "Bản cài đặt chưa được cấu hình xác minh số điện thoại.",
    "auth/operation-not-allowed":
      "Kiểm tra Phone provider và vùng SMS được phép trong Firebase Console.",
    "auth/invalid-app-credential":
      "Firebase không chấp nhận bằng chứng ứng dụng. Kiểm tra chứng chỉ ký APK, package và bước xác minh ứng dụng.",
    "auth/missing-client-identifier":
      "Firebase chưa xác minh được ứng dụng. Kiểm tra SHA của APK và bước Play Integrity/reCAPTCHA.",
    "auth/captcha-check-failed": "Xác minh reCAPTCHA chưa thành công.",
    "auth/missing-activity":
      "Không mở được màn hình xác minh ứng dụng. Giữ ACheck ở phía trước khi gửi mã.",
    "auth/invalid-api-key": "Cấu hình API key Firebase chưa hợp lệ.",
    "auth/app-not-verified": "Firebase chưa xác minh được bản cài đặt này.",
    "auth/billing-not-enabled": "Kiểm tra billing của dự án Firebase trước khi gửi SMS thật.",
    "auth/internal-error":
      "Firebase trả lỗi nội bộ. Cần kiểm tra cấu hình dự án và xác minh ứng dụng; không gửi lại liên tục.",
    "auth/unknown": "Firebase trả lỗi chưa phân loại; cần kiểm tra thêm trên thiết bị.",
    "auth/web-context-cancelled":
      "Bước xác minh trên trình duyệt đã đóng hoặc bị hủy. Chưa hoàn tất xác minh ứng dụng.",
    "auth/web-context-already-presented":
      "Một màn hình xác minh đang mở. Hoàn tất hoặc đóng màn hình đó trước khi thử lại.",
    "auth/web-network-request-failed":
      "Trang xác minh trên trình duyệt không kết nối được. Kiểm tra mạng trong BlueStacks.",
    "app/no-app":
      "APK chưa có Firebase default app. Kiểm tra google-services.json của bản cài đặt.",
  };
  // Permit bounded SDK identifiers, not arbitrary strings/messages or credentials.
  const known = typeof code === "string" && Object.hasOwn(messages, code);
  const sdkCode = typeof code === "string" &&
    /^(?:auth|app)\/(?:[a-z][a-z-]{0,63}|error-code:-?\d{1,6})$/.test(code)
    ? code : null;
  const rawMessage = cause instanceof Error ? cause.message : "";
  const localReason = /No Firebase App/.test(rawMessage)
    ? "NO-DEFAULT-APP"
    : /did not return a verificationId/.test(rawMessage)
      ? "NO-VERIFICATION-ID"
      : /not a function|is not a function/.test(rawMessage)
        ? "MISSING-METHOD"
        : cause instanceof TypeError
          ? "JS-TYPE"
          : "UNKNOWN";
  return new Error(
    known
      ? `[${code}] ${messages[code]}`
      : sdkCode
        ? `[${sdkCode}] Không hoàn tất xác minh Firebase (bước ${step}). Gửi mã lỗi này để kiểm tra; không gửi lại liên tục.`
      : `[PHONE-UNCLASSIFIED/${step}/${localReason}] Không xác minh được số điện thoại. Cần kiểm tra thêm; không gửi lại liên tục.`,
  );
}

/** One native operation at a time. Native Firebase calls cannot be aborted;
 * aborted results are discarded and SDK sessions are signed out before reuse.
 * Confirmation/ID token stay only in memory, never in a deep link or storage.
 */
export function createFirebasePhoneVerifier(
  sdk: PhoneSdk,
  now = Date.now,
): PhoneVerifier {
  let current: {
    id: string;
    expires: number;
    confirmation: Awaited<ReturnType<PhoneSdk["send"]>>;
  } | null = null;
  let sequence = 0;
  let epoch = 0;
  let busy = false;
  const cooldown = new Map<string, number>();
  function active(signal: AbortSignal, generation: number) {
    if (signal.aborted || generation !== epoch)
      throw new Error("Yêu cầu đã được hủy.");
  }
  return {
    cancel() {
      ++epoch;
      current = null;
      if (!busy) void sdk.signOut().catch(() => undefined);
    },
    async send(phone, signal) {
      if (signal.aborted || busy)
        throw new Error("Yêu cầu đang xử lý hoặc đã được hủy.");
      if (normalizePhone(phone) !== phone)
        throw new Error("Số điện thoại chưa hợp lệ.");
      if ((cooldown.get(phone) ?? 0) > now())
        throw new Error("Vui lòng đợi hết bộ đếm trước khi gửi lại.");
      for (const [number, until] of cooldown)
        if (until <= now()) cooldown.delete(number);
      if (cooldown.size >= 50)
        throw new Error("Có quá nhiều yêu cầu. Vui lòng thử lại sau.");
      busy = true;
      const generation = ++epoch;
      current = null;
      // Reserve before dispatch: an aborted/uncertain SMS request still costs money.
      const resendAt = now() + 60_000;
      cooldown.set(phone, resendAt);
      let step: PhoneStep = "SIGNOUT_BEFORE_SMS";
      try {
        await sdk.signOut();
        active(signal, generation);
        step = "SEND_SMS";
        const confirmation = await sdk.send(phone);
        step = "SIGNOUT_AFTER_SMS";
        await sdk.signOut();
        active(signal, generation);
        const id = `firebase-${++sequence}`;
        current = { id, confirmation, expires: now() + 300_000 };
        return { challengeId: id, resendAt };
      } catch (error) {
        await sdk.signOut().catch(() => undefined);
        throw signal.aborted || generation !== epoch
          ? new Error("Yêu cầu đã được hủy.")
          : phoneError(error, step);
      } finally {
        busy = false;
      }
    },
    async confirm(id, code, signal) {
      if (signal.aborted || busy)
        throw new Error("Yêu cầu đang xử lý hoặc đã được hủy.");
      const challenge = current;
      if (!challenge || challenge.id !== id || challenge.expires <= now())
        throw new Error("Mã đã hết hạn. Vui lòng gửi lại.");
      if (!/^\d{6}$/.test(code)) throw new Error("Nhập đủ 6 chữ số.");
      busy = true;
      const generation = epoch;
      let token: string | undefined;
      let failure: Error | undefined;
      try {
        token = await challenge.confirmation.confirm(code);
        active(signal, generation);
        current = null;
      } catch (error) {
        failure =
          signal.aborted || generation !== epoch
            ? new Error("Yêu cầu đã được hủy.")
            : phoneError(error);
      }
      try {
        await sdk.signOut();
      } catch (error) {
        failure = phoneError(error);
      } finally {
        busy = false;
      }
      if (failure) throw failure;
      active(signal, generation);
      return token!;
    },
  };
}
