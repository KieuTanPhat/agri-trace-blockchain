import Constants from "expo-constants";
import { PhoneAuthError, type PhoneVerification } from "./phone-challenge";
import type { PhoneAuthSnapshot } from "@react-native-firebase/auth";

let activeAttempt = 0;

export async function requestPhoneVerification(
  phone: string,
  forceResend = false,
): Promise<PhoneVerification> {
  if (Constants.expoConfig?.extra?.phoneAuthEnabled !== true)
    throw new PhoneAuthError(
      "APK chưa bật Firebase SMS. Cần cấu hình Firebase đúng package và build lại development client.",
    );
  const attempt = ++activeAttempt;
  try {
    const { getAuth, verifyPhoneNumber, PhoneAuthProvider, signInWithCredential, signOut, getIdToken } =
      await import("@react-native-firebase/auth");
    const auth = getAuth();
    if (auth.currentUser) await signOut(auth);
    if (attempt !== activeAttempt) throw new PhoneAuthError("Đã đóng phiên xác minh.");
    let disposed = false;
    let verificationId: string | undefined;
    let automatic: PhoneAuthSnapshot | undefined;
    let failure: unknown;
    const current = () => !disposed && attempt === activeAttempt;
    const assertCurrent = () => {
      if (!current()) throw new PhoneAuthError("Đã đóng phiên xác minh.");
    };
    const verification: PhoneVerification = {
      get automaticallyVerified() { return current() && !!automatic && !failure; },
      async confirm(code) {
        assertCurrent();
        if (failure) throw failure;
        if (!automatic && !verificationId) throw new PhoneAuthError("Chưa nhận được phiên xác minh Firebase.");
        // This native listener reports auto-verification without consuming OTP.
        // An instant-verification snapshot may have a null ID at runtime; RNFB
        // then uses its cached native PhoneAuthCredential.
        const credential = PhoneAuthProvider.credential(
          automatic ? automatic.verificationId : verificationId!,
          automatic ? (automatic.code ?? "") : code,
        );
        const result = await signInWithCredential(auth, credential);
        assertCurrent();
        const user = result.user;
        if (!user || user.phoneNumber !== phone)
          throw new PhoneAuthError(
            "Firebase chưa xác minh đúng số điện thoại này.",
          );
        const token = await getIdToken(user, true);
        assertCurrent();
        return token;
      },
      async dispose() {
        const owned = current();
        disposed = true;
        automatic = undefined;
        if (owned) {
          activeAttempt++;
          if (auth.currentUser?.phoneNumber === phone) await signOut(auth);
        }
      },
    };
    return await new Promise<PhoneVerification>((resolve, reject) => {
      // Unlike modular signInWithPhoneNumber, this API supports force-resend
      // and does not automatically sign in and consume the user's SMS code.
      verifyPhoneNumber(auth, phone, 60, forceResend).on("state_changed", snapshot => {
        if (!current()) { reject(new PhoneAuthError("Đã đóng phiên xác minh.")); return; }
        if (snapshot.error || snapshot.state === "error") {
          failure = snapshot.error ?? new PhoneAuthError("Firebase không hoàn tất gửi mã.");
          automatic = undefined;
          reject(failure);
          return;
        }
        if (snapshot.verificationId) verificationId = snapshot.verificationId;
        if (snapshot.state === "verified") automatic = snapshot;
        // Auto-retrieval timeout is not OTP expiry; manual entry still works.
        if (verificationId || automatic) resolve(verification);
      });
    });
  } catch (error) {
    if (
      /RNFB|native module|No Firebase App/i.test(
        error instanceof Error ? error.message : "",
      )
    )
      throw new PhoneAuthError(
        "Không nạp được Firebase native. Cài APK development mới có module Firebase, rồi mở lại app.",
      );
    throw error;
  }
}
