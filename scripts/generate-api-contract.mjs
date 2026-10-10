import { validateContract } from "./ci/api-contract-validation.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";
import SwaggerParser from "@apidevtools/swagger-parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((arg) => arg !== "--check"))
  throw new Error("Unknown argument");
const temporaryRoot = resolve(tmpdir());
const temporary = await mkdtemp(join(temporaryRoot, "agri-trace-openapi-"));
try {
  const schema = join(temporary, "openapi.json");
  execFileSync(
    process.execPath,
    [join(root, "apps/api/dist/openapi-export.js"), schema],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, OPENAPI_EXPORT: "true" },
    },
  );
  const json = await readFile(schema, "utf8");
  await SwaggerParser.validate(JSON.parse(json));
  const document = JSON.parse(json);
  const operationCount = validateContract(document);
  process.stdout.write(
    `Validated ${operationCount} operations and the public projection.\n`,
  );
  const operations = Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([, operation]) => operation.operationId)
      .map(([method, operation]) => ({
        method: method.toUpperCase(),
        path,
        operationId: operation.operationId,
      })),
  );
  const types = astToString(
    await openapiTS(pathToFileURL(schema), {
      alphabetize: true,
      arrayLength: true,
    }),
  );
  const artifacts = [
    ["docs/openapi/openapi.json", json],
    [
      "docs/openapi/openapi.sha256",
      `${createHash("sha256").update(json.replaceAll("\r\n", "\n")).digest("hex")}  openapi.json\n`,
    ],
    [
      "docs/openapi/operations.json",
      `${JSON.stringify(operations, null, 2)}\n`,
    ],
    ["apps/web/src/lib/generated/api.d.ts", types],
  ];
  for (const [relative, content] of artifacts) {
    const path = join(root, relative);
    if (check) {
      const existing = await readFile(path, "utf8").catch(() => "");
      if (
        existing.replaceAll("\r\n", "\n") !== content.replaceAll("\r\n", "\n")
      )
        throw new Error(
          `${relative} is stale; run npm run api-contract:generate`,
        );
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, "utf8");
    }
  }
  process.stdout.write(
    `API contract ${check ? "matches" : "generated"} from compiled NestJS metadata.\n`,
  );
} finally {
  if (
    dirname(resolve(temporary)) !== temporaryRoot ||
    !basename(temporary).startsWith("agri-trace-openapi-")
  )
    throw new Error("Unsafe temporary cleanup path");
  await rm(temporary, { recursive: true, force: true });
}
