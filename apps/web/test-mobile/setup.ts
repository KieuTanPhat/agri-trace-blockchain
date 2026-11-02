import { vi } from "vitest";

// Mobile logic tests run in JSDOM, outside the native Expo runtime. Keep the
// native crypto boundary explicit; individual tests can replace this provider.
vi.mock("../../mobile/node_modules/expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));
