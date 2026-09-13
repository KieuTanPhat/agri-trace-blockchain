import { contractError } from "./errors";
import {
  CANONICALIZATION_VERSION,
  SCHEMA_VERSION,
  SUPPORTED_EVENT_TYPE,
  type TraceEventInput
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA_256 = /^[a-f0-9]{64}$/;
const FORBIDDEN_METADATA_KEY = /(password|secret|token|private.?key|raw.?reading|payload)/i;
const TOP_LEVEL_KEYS = new Set([
  "eventId",
  "batchId",
  "eventType",
  "eventTime",
  "dataHash",
  "schemaVersion",
  "canonicalizationVersion",
  "actorContext",
  "actorAuthProof",
  "payloadMetadata"
]);

export function parseTraceEventInput(inputJson: string): TraceEventInput {
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    throw contractError("INVALID_INPUT", "TraceEvent must be valid JSON");
  }

  if (!isRecord(input)) {
    throw contractError("INVALID_INPUT", "TraceEvent must be a JSON object");
  }
  const unknownKeys = Object.keys(input).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw contractError("INVALID_INPUT", `Unknown field: ${unknownKeys[0]}`);
  }

  requireMatch(input.eventId, UUID, "eventId must be a UUID");
  requireMatch(input.batchId, BATCH_ID, "batchId format is invalid");
  if (input.eventType !== SUPPORTED_EVENT_TYPE) {
    throw contractError("UNSUPPORTED_EVENT_TYPE", `Only ${SUPPORTED_EVENT_TYPE} is enabled in weeks 1-2`);
  }
  requireDateTime(input.eventTime, "eventTime");
  requireMatch(input.dataHash, SHA_256, "dataHash must be lowercase SHA-256 hex");
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw contractError("INVALID_INPUT", `schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (input.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    throw contractError("INVALID_INPUT", `canonicalizationVersion must be ${CANONICALIZATION_VERSION}`);
  }

  validateActorContext(input.actorContext);
  validateActorAuthProof(input.actorAuthProof);
  if (input.actorAuthProof.principalId !== input.actorContext.actorId) {
    throw contractError("INVALID_INPUT", "actorAuthProof.principalId must match actorContext.actorId");
  }
  validateMetadata(input.payloadMetadata);

  return input as unknown as TraceEventInput;
}

export function requireEventId(value: string): string {
  requireMatch(value, UUID, "eventId must be a UUID");
  return value;
}

export function requireBatchId(value: string): string {
  requireMatch(value, BATCH_ID, "batchId format is invalid");
  return value;
}

function validateActorContext(value: unknown): asserts value is TraceEventInput["actorContext"] {
  if (!isRecord(value)) {
    throw contractError("INVALID_INPUT", "actorContext must be an object");
  }
  requireExactKeys(value, ["actorId", "role", "organizationId"], "actorContext");
  requireMatch(value.actorId, UUID, "actorContext.actorId must be a UUID");
  requireMatch(value.organizationId, UUID, "actorContext.organizationId must be a UUID");
  if (value.role !== "FARM_STAFF") {
    throw contractError("INVALID_INPUT", "BATCH_CREATED actor role must be FARM_STAFF");
  }
}

function validateActorAuthProof(value: unknown): asserts value is TraceEventInput["actorAuthProof"] {
  if (!isRecord(value)) {
    throw contractError("INVALID_INPUT", "actorAuthProof must be an object");
  }
  requireExactKeys(
    value,
    ["proofType", "principalId", "authenticatedAt", "requestId", "proofHash"],
    "actorAuthProof"
  );
  if (value.proofType !== "BACKEND_AUTH_CONTEXT") {
    throw contractError("INVALID_INPUT", "actorAuthProof.proofType is invalid");
  }
  requireMatch(value.principalId, UUID, "actorAuthProof.principalId must be a UUID");
  requireDateTime(value.authenticatedAt, "actorAuthProof.authenticatedAt");
  if (typeof value.requestId !== "string" || value.requestId.length === 0 || value.requestId.length > 128) {
    throw contractError("INVALID_INPUT", "actorAuthProof.requestId length is invalid");
  }
  requireMatch(value.proofHash, SHA_256, "actorAuthProof.proofHash must be lowercase SHA-256 hex");
}

function validateMetadata(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    throw contractError("INVALID_INPUT", "payloadMetadata must be an object");
  }
  if (Object.keys(value).length > 32) {
    throw contractError("INVALID_INPUT", "payloadMetadata has too many properties");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 8 * 1024) {
    throw contractError("INVALID_INPUT", "payloadMetadata exceeds 8 KiB");
  }
  walkMetadata(value);
}

function walkMetadata(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) walkMetadata(item);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_METADATA_KEY.test(key)) {
      throw contractError("INVALID_INPUT", `payloadMetadata contains forbidden key: ${key}`);
    }
    walkMetadata(item);
  }
}

function requireExactKeys(value: Record<string, unknown>, expected: string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((key, index) => key !== sortedExpected[index])) {
    throw contractError("INVALID_INPUT", `${label} fields are invalid`);
  }
}

function requireMatch(value: unknown, pattern: RegExp, message: string): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw contractError("INVALID_INPUT", message);
  }
}

function requireDateTime(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw contractError("INVALID_INPUT", `${label} must be UTC RFC 3339`);
  }
  if (Number.isNaN(Date.parse(value))) {
    throw contractError("INVALID_INPUT", `${label} is not a real timestamp`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
