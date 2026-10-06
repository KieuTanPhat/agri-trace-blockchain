import "@testing-library/jest-dom/vitest";
import type {} from "vitest/jsdom";

// Node 26 also defines Web Storage globals. Browser tests must use storage
// owned by this JSDOM window rather than Node's optional file-backed storage.
for (const name of ["localStorage", "sessionStorage"] as const) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => jsdom.window[name],
  });
}
