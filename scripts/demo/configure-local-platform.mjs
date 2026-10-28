// Enable encrypted demo privacy records on the already verified local stack.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd(),
  local = path.join(root, ".codex", "seed-current");
const [api] = JSON.parse(
  execFileSync("docker", ["inspect", "agri-trace-demo-local-api-1"], {
    encoding: "utf8",
  }),
);
assert.equal(
  api.Config.Labels["com.docker.compose.project"],
  "agri-trace-demo-local",
);
assert.equal(
  path.resolve(api.Config.Labels["com.docker.compose.project.working_dir"]),
  root,
);
assert.equal(
  api.Config.Labels["com.docker.compose.project.environment_file"],
  path.join(root, ".env.docker"),
);
await mkdir(local, { recursive: true });
const envFile = path.join(local, "platform-secrets.env");
try {
  await writeFile(
    envFile,
    `PLATFORM_SECRET_KEY=${randomBytes(32).toString("hex")}\n`,
    { flag: "wx", mode: 0o600 },
  );
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}
const override = {
  services: {
    api: { image: api.Image, pull_policy: "never", env_file: [envFile] },
  },
};
await writeFile(
  path.join(local, "runtime.override.json"),
  JSON.stringify(override, null, 2),
);
console.log(
  "Local platform secret file and pinned-image override prepared. No secret printed.",
);
