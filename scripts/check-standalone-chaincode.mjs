import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.npm_execpath) {
  throw new Error("Run through npm run check:chaincode:standalone");
}
const root = fileURLToPath(new URL("../", import.meta.url));
const source = path.join(root, "blockchain/chaincode");
const evidence = path.resolve(
  root,
  process.argv[2] ?? ".codex/evidence/dependencies",
);
const logs = path.join(evidence, "chaincode");
mkdirSync(logs, { recursive: true });
const stage = mkdtempSync(
  path.join(tmpdir(), "agri-trace-standalone-chaincode-"),
);

function run(name, args, cwd) {
  console.log(`standalone-chaincode/${name}: running`);
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    timeout: 300_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  writeFileSync(path.join(logs, `${name}.log`), output);
  process.stdout.write(output);
  if (result.error || result.status !== 0) {
    throw new Error(`${name} failed (exit ${result.status})`, {
      cause: result.error,
    });
  }
}

try {
  // These are the inputs of the independent package's existing check command.
  // Separate node_modules prevents its lockfile from changing root resolution.
  for (const entry of [
    "package.json",
    "package-lock.json",
    "src",
    "test",
    "tsconfig.json",
    "vitest.config.ts",
  ]) {
    cpSync(path.join(source, entry), path.join(stage, entry), {
      recursive: true,
    });
  }
  run(
    "npm-ci",
    [process.env.npm_execpath, "--prefix", stage, "ci", "--workspaces=false"],
    stage,
  );
  run(
    "audit",
    [
      path.join(root, "scripts/audit-dependencies.mjs"),
      "chaincode",
      evidence,
      stage,
    ],
    root,
  );
  run(
    "check",
    [
      process.env.npm_execpath,
      "--prefix",
      stage,
      "run",
      "check",
      "--workspaces=false",
    ],
    stage,
  );
  console.log("standalone-chaincode: PASS");
} finally {
  const resolved = realpathSync(stage);
  assert.equal(path.dirname(resolved), realpathSync(tmpdir()));
  assert.ok(
    path.basename(resolved).startsWith("agri-trace-standalone-chaincode-"),
  );
  rmSync(resolved, { recursive: true });
}
