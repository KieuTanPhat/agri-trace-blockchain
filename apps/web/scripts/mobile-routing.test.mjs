import { test } from "node:test";
import assert from "node:assert/strict";
import imported from "../next.config.ts";
const config = imported.default ?? imported;
test("consumer and staff deep links use the exported app without claiming API or Next asset routes", async () => {
  const routes = await config.rewrites();
  assert.deepEqual(routes.beforeFiles, [
    { source: "/consumer/:path*", destination: "/mobile/index.html" },
    { source: "/staff/:path*", destination: "/mobile/index.html" },
    { source: "/_expo/:path*", destination: "/mobile/_expo/:path*" },
    { source: "/assets/:path*", destination: "/mobile/assets/:path*" },
  ]);
  assert(
    routes.beforeFiles.every(
      (r) => !r.source.startsWith("/api") && !r.source.startsWith("/_next"),
    ),
  );
});
