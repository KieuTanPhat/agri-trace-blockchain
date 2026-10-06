import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const scope = process.argv[2] ?? "workspace";
const chaincodeSource = path.join(root, "blockchain/chaincode");
const chaincodeInstall = process.argv[4]
  ? path.resolve(process.argv[4])
  : chaincodeSource;
const output = path.resolve(
  root,
  process.argv[3] ?? ".codex/evidence/dependencies",
);
if (!["workspace", "chaincode", "all"].includes(scope)) {
  throw new Error("Scope must be workspace, chaincode or all");
}
if (!process.env.npm_execpath) {
  throw new Error("Run through npm run audit:dependencies");
}

const startedAt = new Date().toISOString();
const run = (command, args, cwd = root) =>
  spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
// Explicit prefix keeps npm's standalone graph traversal inside chaincode,
// even though that directory is also listed in the parent workspace manifest.
const npm = (args, cwd = root) =>
  run(
    process.execPath,
    [process.env.npm_execpath, "--prefix", cwd, ...args],
    cwd,
  );
const git = run("git", ["rev-parse", "HEAD"]);
if (git.error || git.status !== 0) {
  throw new Error(`Cannot identify the checked-out commit: ${git.stderr}`, {
    cause: git.error,
  });
}
const status = run("git", ["status", "--porcelain"]);
if (status.error || status.status !== 0) {
  throw new Error("Cannot identify uncommitted changes", {
    cause: status.error,
  });
}
const npmVersion = npm(["--version"]);
if (npmVersion.error || npmVersion.status !== 0) {
  throw new Error("Cannot identify npm version", { cause: npmVersion.error });
}
let failed = false;

for (const target of ["workspace", "chaincode"].filter(
  (name) => scope === "all" || name === scope,
)) {
  const source = target === "workspace" ? root : chaincodeSource;
  const cwd = target === "workspace" ? root : chaincodeInstall;
  const directory = path.join(output, target);
  const manifest = JSON.parse(
    readFileSync(path.join(cwd, "package.json"), "utf8"),
  );
  mkdirSync(directory, { recursive: true });
  for (const filename of ["package.json", "package-lock.json"]) {
    if (
      !readFileSync(path.join(source, filename)).equals(
        readFileSync(path.join(cwd, filename)),
      )
    ) {
      throw new Error(
        `Installed ${target}/${filename} differs from the source checkout`,
      );
    }
  }
  const extra = target === "chaincode" ? ["--workspaces=false"] : [];
  const results = [];
  // Keep the full dependency gate, including build/lint tools. Both high and
  // moderate advisories are in AGT-002's scope; production is audited separately.
  for (const [name, args] of [
    ["audit-full", ["audit", ...extra, "--audit-level=moderate", "--json"]],
    [
      "audit-production",
      ["audit", ...extra, "--omit=dev", "--audit-level=moderate", "--json"],
    ],
    ["installed-tree", ["ls", ...extra, "--all", "--json"]],
  ]) {
    const result = npm(args, cwd);
    let report;
    try {
      report = JSON.parse(result.stdout);
      if (!report || typeof report !== "object" || Array.isArray(report)) {
        throw new Error("npm did not return a JSON object");
      }
    } catch {
      // Preserve diagnostics even when npm or the registry cannot return JSON.
      report = {
        error: result.error?.message ?? "npm did not return valid JSON",
        stdout: result.stdout,
      };
    }
    writeFileSync(
      path.join(directory, `${name}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    writeFileSync(
      path.join(directory, `${name}.stderr.log`),
      result.stderr ?? "",
    );
    const validReport =
      name === "installed-tree"
        ? report.name === manifest.name &&
          !!report.dependencies &&
          typeof report.dependencies === "object"
        : !!report.metadata?.vulnerabilities &&
          typeof report.metadata.vulnerabilities === "object";
    const ok =
      !result.error &&
      result.status === 0 &&
      !report.error &&
      validReport &&
      !report.problems?.length;
    failed ||= !ok;
    results.push({
      name,
      cwd: path.relative(root, cwd).replaceAll("\\", "/") || ".",
      command: ["npm", "--prefix", cwd, ...args],
      exitCode: result.status,
      error: result.error?.message ?? null,
      passed: ok,
    });
    console.log(
      `${target}/${name}: ${ok ? "PASS" : "FAIL"} ${JSON.stringify(report.metadata?.vulnerabilities ?? report.problems ?? [])}`,
    );
  }
  const locks = ["package.json", "package-lock.json"].map((filename) => ({
    path: path
      .relative(root, path.join(source, filename))
      .replaceAll("\\", "/"),
    sha256: createHash("sha256")
      .update(readFileSync(path.join(cwd, filename)))
      .digest("hex"),
  }));
  console.log(
    `${target}/evidence: ${JSON.stringify({
      checkedOutSha: git.stdout.trim(),
      prHeadSha: process.env.PR_HEAD_SHA ?? null,
      worktreeDirty: status.stdout.trim().length > 0,
      node: process.version,
      npm: npmVersion.stdout.trim(),
      locks,
    })}`,
  );
  writeFileSync(
    path.join(directory, "metadata.json"),
    JSON.stringify(
      {
        scope: target,
        installDirectory: cwd,
        startedAt,
        completedAt: new Date().toISOString(),
        checkedOutSha: git.stdout.trim(),
        worktreeDirty: status.stdout.trim().length > 0,
        prHeadSha: process.env.PR_HEAD_SHA ?? null,
        githubRunUrl:
          process.env.GITHUB_SERVER_URL &&
          process.env.GITHUB_REPOSITORY &&
          process.env.GITHUB_RUN_ID
            ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
            : null,
        node: process.version,
        npm: npmVersion.stdout.trim(),
        platform: process.platform,
        architecture: process.arch,
        auditLevel: "moderate",
        locks,
        results,
      },
      null,
      2,
    ) + "\n",
  );
}

process.exitCode = failed ? 1 : 0;
