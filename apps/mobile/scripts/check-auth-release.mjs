import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const platform = process.argv[2] ?? "web";
assert.ok(
  ["web", "android", "ios"].includes(platform),
  "Unsupported export platform",
);
const output = resolve(root, `dist/auth-release-check-${platform}`);
// Intentionally enabled: production mode must still remove dev authentication.
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Run through npm run test:auth-release");
const result = spawnSync(
  process.execPath,
  [npmCli,
    "exec",
    "--",
    "expo",
    "export",
    "--platform",
    platform,
    "--output-dir",
    output,
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_NO_TELEMETRY: "1",
      EXPO_PUBLIC_AUTH_DEMO: "true",
      EXPO_PUBLIC_CONSUMER_AUTH: "true",
      EXPO_PUBLIC_API_BASE_URL: "https://mobile-fixture.invalid/api",
    },
  },
);
assert.equal(result.status, 0, "Release bundle must export");
async function inspect(directory) {
  let count = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) count += await inspect(path);
    else if (/\.(js|hbc|map)$/.test(entry.name)) {
      const body = await readFile(path);
      for (const marker of [
        "ACHECK_DEV_AUTH_ONLY_20261019",
        "Demo-only-1234",
        "DEV-PREVIEW-NOT-LEGAL-20261019",
        "DEV-CONSUMER-TEST-20261020",
      ]) {
        assert.ok(
          !body.includes(Buffer.from(marker)),
          `Dev authentication leaked into ${entry.name}`,
        );
      }
      count++;
    }
  }
  return count;
}
assert.ok(await inspect(output), "Must inspect actual release JavaScript");
console.log(
  "Release auth boundary passed, even with EXPO_PUBLIC_AUTH_DEMO=true.",
);
