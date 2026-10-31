import { PhoneAuthError, type PhoneVerification } from "./phone-challenge";
/** Web preview has no native app verification. Never accept a made-up OTP. */
export async function requestPhoneVerification(
  _phone: string,
): Promise<PhoneVerification> {
  throw new PhoneAuthError(
    "Xác minh SMS cần APK development có Firebase; bản Web và Expo Go không hỗ trợ.",
  );
}
