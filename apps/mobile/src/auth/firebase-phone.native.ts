import Constants from "expo-constants";
import { PhoneAuthError, type PhoneVerification } from "./phone-challenge";

export async function requestPhoneVerification(
  phone: string,
): Promise<PhoneVerification> {
  if (Constants.expoConfig?.extra?.phoneAuthEnabled !== true)
    throw new PhoneAuthError(
      "APK chưa bật Firebase SMS. Cần cấu hình Firebase đúng package và build lại development client.",
    );
  try {
    const { getAuth, signInWithPhoneNumber, signOut, getIdToken } =
      await import("@react-native-firebase/auth");
    const auth = getAuth();
    if (auth.currentUser) await signOut(auth);
    const verification = await signInWithPhoneNumber(auth, phone);
    return {
      async confirm(code) {
        const credential = await verification.confirm(code);
        const user = credential?.user ?? auth.currentUser;
        if (!user || user.phoneNumber !== phone)
          throw new PhoneAuthError(
            "Firebase chưa xác minh đúng số điện thoại này.",
          );
        return getIdToken(user, true);
      },
      async dispose() {
        if (auth.currentUser) await signOut(auth);
      },
    };
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
