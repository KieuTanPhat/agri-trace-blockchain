import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../../apps/mobile/", import.meta.url));
const output = join(directory, ".audit");
mkdirSync(output, { recursive: true });
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run through npm run audit:mobile");
let failed = false;
for (const [name, args] of [
  [
    "full",
    [
      "audit",
      "--package-lock-only",
      "--audit-level=moderate",
      "--json",
      "--workspaces=false",
    ],
  ],
  [
    "production",
    [
      "audit",
      "--package-lock-only",
      "--omit=dev",
      "--audit-level=moderate",
      "--json",
      "--workspaces=false",
    ],
  ],
  ["installed-graph", ["ls", "--all", "--json", "--workspaces=false"]],
]) {
  const result = spawnSync(
    process.execPath,
    [npmCli, "--prefix", directory, ...args],
    {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  writeFileSync(join(output, `${name}.json`), result.stdout || "{}\n");
  writeFileSync(join(output, `${name}.stderr.txt`), result.stderr || "");
  if (result.status !== 0 || result.error) failed = true;
  console.log(
    `${name}: ${result.status === 0 && !result.error ? "passed" : "FAILED"}; evidence in apps/mobile/.audit/${name}.json`,
  );
}
writeFileSync(
  join(output, "metadata.json"),
  JSON.stringify(
    {
      date: new Date().toISOString(),
      sha: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: directory,
        encoding: "utf8",
      }).trim(),
      node: process.version,
      npm: execFileSync(process.execPath, [npmCli, "--version"], {
        encoding: "utf8",
      }).trim(),
      lockfileSha256: createHash("sha256")
        .update(readFileSync(join(directory, "package-lock.json")))
        .digest("hex"),
      // No audit exceptions have been approved for this candidate.
      exceptions: [],
    },
    null,
    2,
  ),
);
if (failed) process.exitCode = 1;
