import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const command = process.argv[2] ?? "dev";
export function assertProductionRuntime(command, env) {
  if (command === "build" && (
    env.NEXT_PUBLIC_MOCK_API === "true" ||
    env.NEXT_PUBLIC_USE_MOCK_API === "true" ||
    env.NEXT_PUBLIC_API_MODE === "mock"
  )) throw new Error("Production builds require real API mode; mock flags are forbidden");
}
assertProductionRuntime(command, process.env);
const nextBin = require.resolve("next/dist/bin/next");
const nativeEnv = { ...process.env };
delete nativeEnv.NEXT_TEST_WASM_DIR;

const child = spawn(process.execPath, [nextBin, command, ...process.argv.slice(3)], {
  env: nativeEnv,
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
