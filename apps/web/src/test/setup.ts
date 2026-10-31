import "@testing-library/jest-dom/vitest";
import type {} from "vitest/jsdom";
import { vi } from "vitest";

// Mobile logic tests run in JSDOM, outside the native Expo runtime. Keep the
// native crypto boundary explicit; individual tests can replace this provider.
vi.mock("../../../mobile/node_modules/expo-crypto", async () => ({
  randomUUID: (await import("node:crypto")).randomUUID,
}));

// Node 26 also defines Web Storage globals. Browser tests must use storage
// owned by this JSDOM window rather than Node's optional file-backed storage.
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => jsdom.window[name],
  });
}
