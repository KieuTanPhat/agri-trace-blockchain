export type AuthStartupStage =
  | "API_CONFIG"
  | "NATIVE_MODULES"
  | "SESSION_INIT"
  | "FIREBASE_MODULE";

/** Fixed diagnostics only: never render/log arbitrary SDK error messages. */
export function authStartupDiagnostic(
  stage: AuthStartupStage,
  cause: unknown,
): string {
  const message = cause instanceof Error ? cause.message : "";
  if (stage === "API_CONFIG")
    return "[AUTH-API-CONFIG] Kiểm tra EXPO_PUBLIC_API_BASE_URL, dạng http://IP:8080/api trong bản dev, rồi khởi động lại Metro với --clear.";
  if (/RNFBAppModule|RNFBAuthModule/.test(message))
    return "[AUTH-FIREBASE-NATIVE] APK không nạp được module Firebase native. Kiểm tra đúng bản development đã cài; chỉ reload JS không bổ sung được module native.";
  if (/ExpoSecureStore/.test(message))
    return "[AUTH-SECURESTORE-NATIVE] APK không nạp được SecureStore native. Kiểm tra bản development có expo-secure-store.";
  if (/No Firebase App|no-app/.test(message))
    return "[AUTH-FIREBASE-CONFIG] Firebase chưa có default app. Kiểm tra google-services.json và package dev.agritrace.consumer của APK.";
  const advice: Record<Exclude<AuthStartupStage, "API_CONFIG">, string> = {
    NATIVE_MODULES: "Không nạp được module phiên native của APK.",
    SESSION_INIT: "Không khởi tạo được bộ quản lý phiên native.",
    FIREBASE_MODULE: "Không nạp được bộ xác minh Firebase của APK.",
  };
  return `[AUTH-${stage.replaceAll("_", "-")}] ${advice[stage]} Gửi mã lỗi này để kiểm tra; chưa cần đổi DB hoặc gửi OTP.`;
}
