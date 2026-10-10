import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const methods = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
  "trace",
]);

// Conservative review report: any modification/removal of an existing contract
// needs BE + FE review. It deliberately does not claim semantic compatibility.
export function compareContracts(base, current) {
  const changes = [];
  for (const field of ["openapi", "security", "servers"])
    if (!isDeepStrictEqual(base[field], current[field]))
      changes.push({ kind: "document-contract-changed", field });
  for (const [path, item] of Object.entries(base.paths ?? {})) {
    const inherited = (value) =>
      Object.fromEntries(
        Object.entries(value ?? {}).filter(([key]) => !methods.has(key)),
      );
    if (!isDeepStrictEqual(inherited(item), inherited(current.paths?.[path])))
      changes.push({ kind: "path-contract-changed", path });
    for (const [method, operation] of Object.entries(item)) {
      if (!methods.has(method)) continue;
      if (!isDeepStrictEqual(operation, current.paths?.[path]?.[method]))
        changes.push({
          kind: "operation-changed-or-removed",
          path,
          method,
          operationId: operation.operationId,
        });
    }
  }
  for (const [section, entries] of Object.entries(base.components ?? {})) {
    for (const [name, value] of Object.entries(entries))
      if (!isDeepStrictEqual(value, current.components?.[section]?.[name]))
        changes.push({ kind: "component-changed-or-removed", section, name });
  }
  return changes;
}

export async function writeEvidence() {
  const directory = "artifacts/openapi";
  await mkdir(directory, { recursive: true });
  const json = (await readFile("docs/openapi/openapi.json", "utf8")).replaceAll(
    "\r\n",
    "\n",
  );
  const current = JSON.parse(json);
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const baseSha = process.env.CONTRACT_BASE_SHA;
  if (baseSha && !/^[a-f0-9]{40,64}$/.test(baseSha))
    throw new Error("Invalid contract base SHA");
  const base = baseSha
    ? JSON.parse(
        execFileSync("git", ["show", `${baseSha}:docs/openapi/openapi.json`], {
          encoding: "utf8",
          maxBuffer: 32 * 1024 * 1024,
        }),
      )
    : null;
  const report = {
    baseSha: baseSha ?? null,
    reviewStatus: "Not Evaluated",
    comparison: base ? "conservative-change-report" : "baseline-not-supplied",
    changesRequiringReview: base ? compareContracts(base, current) : null,
    requiredReviewers: ["Tuấn (Backend/contract)", "Phát (integration/policy)"],
    note: "Changes are candidates for breaking-change review, not confirmed breaks. Auth/RBAC/privacy require review before acceptance.",
  };
  const metadata = {
    sourceSha: sha,
    dirty: Boolean(
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
    ),
    schemaSha256: createHash("sha256").update(json).digest("hex"),
    apiVersion: current.info.version,
    openapiVersion: current.openapi,
    environment: process.env.CI
      ? "CI metadata export (no deployed API)"
      : "local metadata export (no deployed API)",
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    generatedAt: new Date().toISOString(),
    acceptance: "Not Evaluated",
  };
  const operations = Object.entries(current.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, operation]) => operation.operationId)
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
      })),
  );
  for (const [name, value] of Object.entries({
    "metadata.json": metadata,
    "review.json": report,
    "operations.json": operations,
  }))
    await writeFile(
      `${directory}/${name}`,
      `${JSON.stringify(value, null, 2)}\n`,
    );
  await writeFile(`${directory}/openapi.json`, json);
  await writeFile(
    `${directory}/openapi.sha256`,
    `${metadata.schemaSha256}  openapi.json\n`,
  );
  await writeFile(
    `${directory}/api.d.ts`,
    await readFile("apps/web/src/lib/generated/api.d.ts"),
  );
  console.log(
    `Contract evidence: ${directory}; ${operations.length} operations; review ${report.reviewStatus}`,
  );
}

if (
  process.argv[1]?.replaceAll("\\", "/").endsWith("/api-contract-evidence.mjs")
)
  await writeEvidence();
