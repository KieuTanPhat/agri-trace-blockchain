import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// These five finite CHECKs have two PostgreSQL parser/deparser forms after
// pg_dump/restore. No general SQL equivalence or cast removal is authorized.
const reviewedChecks = new Map([
  [
    "certificate.ck_certificate_status",
    ["status", ["PENDING", "APPROVED", "REJECTED"]],
  ],
  [
    "harvest_sensor_window.harvest_sensor_window_status_check",
    ["status", ["FINALIZED", "NO_DATA"]],
  ],
  [
    "compliance_assignment_audit.compliance_assignment_audit_action_check",
    ["action", ["GRANTED", "REVOKED"]],
  ],
  [
    "ledger_route_definition.ledger_route_definition_mode_check",
    ["mode", ["WRITE", "HISTORICAL"]],
  ],
  [
    "ledger_route_import.ledger_route_import_environment_check",
    ["environment", ["production", "isolated"]],
  ],
]);

const inputLimit = 8 * 1024 * 1024;

function stableValue(value, depth = 0) {
  if (depth > 20) throw new Error("Invalid restore guard metadata");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value))
    return value.map((item) => stableValue(item, depth + 1));
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key], depth + 1)]),
    );
  }
  throw new Error("Invalid restore guard metadata");
}

function checkDefinition(name, definition) {
  const reviewed = reviewedChecks.get(name);
  if (!reviewed) return definition;
  const [column, values] = reviewed;
  const originalArray = values
    .map((value) => `'${value}'::character varying`)
    .join(", ");
  const restoredArray = values
    .map((value) => `('${value}'::character varying)::text`)
    .join(", ");
  const original = `CHECK (((${column})::text = ANY ((ARRAY[${originalArray}])::text[])))`;
  const restored = `CHECK (((${column})::text = ANY (ARRAY[${restoredArray}])))`;
  if (definition !== original && definition !== restored)
    throw new Error(
      "Reviewed restore CHECK differs from its exact finite domain",
    );
  return original;
}

/** Return a new, deterministically sorted array; retain every guard and flag. */
export function canonicalizeRestoreGuards(guards) {
  if (!Array.isArray(guards) || guards.length > 10000)
    throw new Error("Invalid restore guard collection");
  const result = guards.map((guard) => {
    if (
      !guard ||
      Array.isArray(guard) ||
      Object.getPrototypeOf(guard) !== Object.prototype ||
      typeof guard.kind !== "string" ||
      typeof guard.name !== "string" ||
      typeof guard.definition !== "string" ||
      typeof guard.state !== "string"
    )
      throw new Error("Invalid restore guard metadata");
    const copy = stableValue(guard);
    if (copy.kind === "constraint")
      copy.definition = checkDefinition(copy.name, copy.definition);
    return copy;
  });
  if (Buffer.byteLength(JSON.stringify(result)) > inputLimit)
    throw new Error("Restore guard metadata exceeds its bound");
  return result.sort((left, right) =>
    Buffer.compare(
      Buffer.from(JSON.stringify(left), "utf8"),
      Buffer.from(JSON.stringify(right), "utf8"),
    ),
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv.length !== 2)
      throw new Error("Unexpected restore guard arguments");
    const raw = readFileSync(0);
    if (raw.length > inputLimit)
      throw new Error("Restore guard input exceeds its bound");
    console.log(
      JSON.stringify(
        canonicalizeRestoreGuards(JSON.parse(raw.toString("utf8"))),
      ),
    );
  } catch {
    console.error(
      "Restore guard canonicalization rejected the input; no guard contents are printed.",
    );
    process.exitCode = 1;
  }
}
