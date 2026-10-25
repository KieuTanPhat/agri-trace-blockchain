import { useSyncExternalStore } from "react";
import { authDemoEnabled, type AuthService, type PhoneVerifier } from "./types";
import { DemoSessionStore } from "./session-store";
import { Platform } from "react-native";
import { apiBaseUrl } from "../config";
import {
  authStartupDiagnostic,
  type AuthStartupStage,
} from "./startup-diagnostic";

let service: AuthService | null = null;
let phone: PhoneVerifier | null = null;
let startupError = "";
export const realAuthEnabled =
  __DEV__ &&
  Platform.OS === "android" &&
  process.env.EXPO_PUBLIC_CONSUMER_AUTH === "true";
let native:
  ReturnType<typeof import("./native-runtime").createNativeRuntime> | undefined;
if (realAuthEnabled) {
  let stage: AuthStartupStage = "API_CONFIG";
  try {
    apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__);
    stage = "NATIVE_MODULES";
    const runtime = (
      require("./native-runtime") as typeof import("./native-runtime")
    );
    stage = "SESSION_INIT";
    native = runtime.createNativeRuntime();
    stage = "FIREBASE_MODULE";
    phone = (
      require("./firebase-phone.native") as typeof import("./firebase-phone.native")
    ).firebasePhone;
    service = native.auth;
  } catch (cause) {
    native = undefined;
    phone = null;
    service = null;
    startupError = authStartupDiagnostic(stage, cause);
  }
} else if (
  __DEV__ &&
  process.env.EXPO_PUBLIC_CONSUMER_AUTH !== "true" &&
  authDemoEnabled(__DEV__, process.env.EXPO_PUBLIC_AUTH_DEMO)
) {
  // Metro removes this branch/module from production exports. Tested on bundles.
  const mock = require("./mock-service") as typeof import("./mock-service");
  const adapters = mock.createMockAuthServices();
  service = adapters.auth;
  phone = adapters.phone;
}
export const demoSession = native?.facade ?? new DemoSessionStore(service);
export const accountAvailable = () => service !== null;
export function restoreNativeSession() {
  if (!native) return;
  const status = native.facade.snapshot().status;
  if (status === "logoutPending" || status === "authenticating") return;
  void native.facade.restore();
}
export function authWorkflow() {
  if (!service || !phone) throw new Error("Tính năng tài khoản chưa sẵn sàng.");
  return { auth: service, phone };
}
export function useAuth() {
  const state = useSyncExternalStore<ReturnType<typeof demoSession.snapshot>>(
    demoSession.subscribe,
    demoSession.snapshot,
    demoSession.snapshot,
  );
  return {
    ...state,
    error: startupError || state.error,
    available: demoSession.available(),
  };
}
