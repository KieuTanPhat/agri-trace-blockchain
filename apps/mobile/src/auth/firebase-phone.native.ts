import {
  getAuth,
  getIdToken,
  signInWithPhoneNumber,
  signInWithCredential,
  PhoneAuthProvider,
  signOut,
} from "@react-native-firebase/auth";
import {
  createFirebasePhoneVerifier,
  signOutFirebaseIfPresent,
} from "./firebase-phone-core";

// Validate native Firebase before offering SMS actions. getAuth() is local and
// does not send an SMS; lazy initialization errors must not be hidden as OTP errors.
const auth = getAuth();

// No loggers, SDK emulator bypasses, hard-coded OTP or Firebase persistence adapters.
export const firebasePhone = createFirebasePhoneVerifier({
  async send(phone) {
    const confirmation = await signInWithPhoneNumber(auth, phone);
    const verificationId = confirmation.verificationId;
    return {
      async confirm(code) {
        // Bind confirmation to THIS challenge, not Android's mutable singleton
        // mVerificationId (which a late callback from a previous send can change).
        if (!verificationId) throw { code: "auth/session-expired" };
        const credential = await signInWithCredential(
          auth,
          PhoneAuthProvider.credential(verificationId, code),
        );
        if (!credential?.user || credential.user.phoneNumber !== phone)
          throw new Error("Phone mismatch");
        return getIdToken(credential.user, true);
      },
    };
  },
  signOut: () => signOutFirebaseIfPresent(() => signOut(auth)),
});
