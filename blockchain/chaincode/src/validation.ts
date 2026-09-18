import { contractError } from "./errors";
import {
  CANONICALIZATION_VERSION,
  ENTITY_TYPES,
  EVENT_TYPES,
  SCHEMA_VERSION,
  type TraceEventInput
} from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256 = /^[a-f0-9]{64}$/;
const ROLE = /^[A-Z][A-Z0-9_]{1,49}$/;
const FORBIDDEN_METADATA_KEY = /(password|secret|token|private.?key|raw.?reading|payload)/i;
const TOP_LEVEL_KEYS = new Set([
  "eventId", "entityType", "entityId", "cycleId", "lotId", "eventType",
  "eventTime", "dataHash", "previousEventHash", "schemaVersion",
  "canonicalizationVersion", "actorContext", "payloadMetadata"
]);

export function parseTraceEventInput(inputJson: string): TraceEventInput {
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    throw contractError("INVALID_INPUT", "TraceEvent must be valid JSON");
  }

  if (!isRecord(input)) throw contractError("INVALID_INPUT", "TraceEvent must be a JSON object");
  const unknownKeys = Object.keys(input).filter((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKeys.length > 0) throw contractError("INVALID_INPUT", `Unknown field: ${unknownKeys[0]}`);

  requireUuid(input.eventId, "eventId");
  requireEnum(input.entityType, ENTITY_TYPES, "entityType");
  requireUuid(input.entityId, "entityId");
  optionalUuid(input.cycleId, "cycleId");
  optionalUuid(input.lotId, "lotId");
  requireEnum(input.eventType, EVENT_TYPES, "eventType");
  requireEntityContext(input);
  requireDateTime(input.eventTime, "eventTime");
  requireMatch(input.dataHash, SHA_256, "dataHash must be lowercase SHA-256 hex");
  if (input.previousEventHash !== undefined) {
    requireMatch(input.previousEventHash, SHA_256, "previousEventHash must be lowercase SHA-256 hex");
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw contractError("INVALID_INPUT", `schemaVersion must be ${SCHEMA_VERSION}`);
  }
  if (input.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    throw contractError("INVALID_INPUT", `canonicalizationVersion must be ${CANONICALIZATION_VERSION}`);
  }
  validateActorContext(input.actorContext);
  validateMetadata(input.payloadMetadata);
  return input as unknown as TraceEventInput;
}

export function requireEventId(value: string): string {
  requireUuid(value, "eventId");
  return value;
}

export function requireEntityType(value: string): TraceEventInput["entityType"] {
  requireEnum(value, ENTITY_TYPES, "entityType");
  return value as TraceEventInput["entityType"];
}

export function requireEntityId(value: string): string {
  requireUuid(value, "entityId");
  return value;
}

function requireEntityContext(input: Record<string, unknown>): void {
  if (["PRODUCTION_CYCLE", "CARE", "SENSOR", "HARVEST"].includes(String(input.entityType)) && !input.cycleId) {
    throw contractError("INVALID_INPUT", `${input.entityType} requires cycleId`);
  }
  if (["LOT", "SHIPMENT", "INSPECTION"].includes(String(input.entityType)) && !input.lotId) {
    throw contractError("INVALID_INPUT", `${input.entityType} requires lotId`);
  }
  if (input.entityType === "CERTIFICATE" && !input.cycleId && !input.lotId) {
    throw contractError("INVALID_INPUT", "CERTIFICATE requires cycleId or lotId");
  }
}

function validateActorContext(value: unknown): asserts value is TraceEventInput["actorContext"] {
  if (!isRecord(value)) throw contractError("INVALID_INPUT", "actorContext must be an object");
  const allowed = new Set(["actorUserId", "organizationId", "role", "authProofType", "actorAuthProof"]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw contractError("INVALID_INPUT", `actorContext contains unknown field: ${unknown[0]}`);
  optionalUuid(value.actorUserId, "actorContext.actorUserId");
  optionalUuid(value.organizationId, "actorContext.organizationId");
  requireMatch(value.role, ROLE, "actorContext.role format is invalid");
  requireEnum(value.authProofType, [
    "DIGITAL_SIGNATURE", "SIGNED_ASSERTION", "TOKEN_FINGERPRINT",
    "DEVICE_SIGNATURE", "SYSTEM_ASSERTION"
  ] as const, "actorContext.authProofType");
  requireMatch(value.actorAuthProof, SHA_256, "actorContext.actorAuthProof must be a SHA-256 fingerprint");
  if (!value.actorUserId && !["IOT_DEVICE", "SYSTEM_ACTOR", "RELAYER_SERVICE"].includes(String(value.role))) {
    throw contractError("INVALID_INPUT", "user-triggered events require actorContext.actorUserId");
  }
}

function validateMetadata(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw contractError("INVALID_INPUT", "payloadMetadata must be an object");
  if (Object.keys(value).length > 32) throw contractError("INVALID_INPUT", "payloadMetadata has too many properties");
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

function optionalUuid(value: unknown, label: string): void {
  if (value !== undefined) requireUuid(value, label);
}

function requireUuid(value: unknown, label: string): asserts value is string {
  requireMatch(value, UUID, `${label} must be a UUID`);
}

function requireEnum<T extends readonly string[]>(value: unknown, values: T, label: string): asserts value is T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw contractError("INVALID_INPUT", `${label} is not supported`);
  }
}

function requireMatch(value: unknown, pattern: RegExp, message: string): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value)) throw contractError("INVALID_INPUT", message);
}

function requireDateTime(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw contractError("INVALID_INPUT", `${label} must be UTC RFC 3339`);
  }
  if (Number.isNaN(Date.parse(value))) throw contractError("INVALID_INPUT", `${label} is not a real timestamp`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
