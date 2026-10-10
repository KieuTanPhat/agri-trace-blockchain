import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const command = process.argv[2] ?? "dev";
if (command === "build" && process.env.NEXT_PUBLIC_MOCK_API === "true")
  throw new Error("Production builds require NEXT_PUBLIC_MOCK_API=false");
const nextBin = require.resolve("next/dist/bin/next");
const wasmPackageJson = require.resolve("@next/swc-wasm-nodejs/package.json");
const wasmDir = path.dirname(wasmPackageJson);

const child = spawn(process.execPath, [nextBin, command, ...process.argv.slice(3)], {
  env: {
    ...process.env,
    NEXT_TEST_WASM_DIR: wasmDir
  },
  stdio: "inherit",
  shell: false
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
