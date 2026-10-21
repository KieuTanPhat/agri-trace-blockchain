import assert from "node:assert/strict";
import test from "node:test";
import {
  authStartupDiagnostic,
  type AuthStartupStage,
} from "../src/auth/startup-diagnostic";

test("startup diagnostics identify configuration and known native failures", () => {
  for (const [stage, message, code] of [
    ["API_CONFIG", "invalid URL", "AUTH-API-CONFIG"],
    ["FIREBASE_MODULE", "RNFBAppModule not found", "AUTH-FIREBASE-NATIVE"],
    ["FIREBASE_MODULE", "RNFBAuthModule not found", "AUTH-FIREBASE-NATIVE"],
    ["NATIVE_MODULES", "Cannot find native module ExpoSecureStore", "AUTH-SECURESTORE-NATIVE"],
    ["FIREBASE_MODULE", "No Firebase App '[DEFAULT]'", "AUTH-FIREBASE-CONFIG"],
  ] as const) {
    assert.ok(authStartupDiagnostic(stage, new Error(message)).includes(code));
  }
});

test("unknown startup errors expose only fixed stage codes, never raw credentials", () => {
  for (const stage of ["API_CONFIG", "NATIVE_MODULES", "SESSION_INIT", "FIREBASE_MODULE"] satisfies AuthStartupStage[]) {
    const secret = "private-token-and-phone-must-not-appear";
    const result = authStartupDiagnostic(stage, new Error(secret));
    assert.ok(result.startsWith("[AUTH-"));
    assert.ok(!result.includes(secret));
    assert.doesNotThrow(() => authStartupDiagnostic(stage, null));
  }
});
