import { contractError } from "./errors";
import {
  CANONICALIZATION_VERSION,
  ENTITY_TYPES,
  EVENT_TYPES,
  SCHEMA_VERSION,
  ENVELOPE_VERSION,
  type TraceEventEnvelope,
} from "./types";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256 = /^[a-f0-9]{64}$/;
const TOP_LEVEL_KEYS = new Set([
  "eventId",
  "entityType",
  "entityId",
  "cycleId",
  "lotId",
  "eventType",
  "eventTime",
  "dataHash",
  "previousEventHash",
  "schemaVersion",
  "canonicalizationVersion",
  "envelopeVersion",
  "nonce",
]);

export function parseTraceEventInput(inputJson: string): TraceEventEnvelope {
  let input: unknown;
  try {
    input = JSON.parse(inputJson);
  } catch {
    throw contractError("INVALID_INPUT", "TraceEvent must be valid JSON");
  }

  if (!isRecord(input))
    throw contractError("INVALID_INPUT", "TraceEvent must be a JSON object");
  const unknownKeys = Object.keys(input).filter(
    (key) => !TOP_LEVEL_KEYS.has(key),
  );
  if (unknownKeys.length > 0)
    throw contractError("INVALID_INPUT", `Unknown field: ${unknownKeys[0]}`);

  requireUuid(input.eventId, "eventId");
  requireUuid(input.nonce, "nonce");
  if (input.nonce !== input.eventId)
    throw contractError("INVALID_INPUT", "nonce must equal persisted eventId");
  if (input.envelopeVersion !== ENVELOPE_VERSION)
    throw contractError(
      "INVALID_INPUT",
      `envelopeVersion must be ${ENVELOPE_VERSION}`,
    );
  requireEnum(input.entityType, ENTITY_TYPES, "entityType");
  requireUuid(input.entityId, "entityId");
  optionalUuid(input.cycleId, "cycleId");
  optionalUuid(input.lotId, "lotId");
  for (const field of ["eventId", "nonce", "entityId", "cycleId", "lotId"]) {
    const value = input[field];
    if (typeof value === "string" && value !== value.toLowerCase())
      throw contractError(
        "INVALID_INPUT",
        `${field} must use canonical lowercase UUID`,
      );
  }
  requireEnum(input.eventType, EVENT_TYPES, "eventType");
  requireEntityContext(input);
  requireDateTime(input.eventTime, "eventTime");
  requireMatch(
    input.dataHash,
    SHA_256,
    "dataHash must be lowercase SHA-256 hex",
  );
  if (input.previousEventHash !== undefined) {
    requireMatch(
      input.previousEventHash,
      SHA_256,
      "previousEventHash must be lowercase SHA-256 hex",
    );
  }
  if (input.schemaVersion !== SCHEMA_VERSION) {
    throw contractError(
      "INVALID_INPUT",
      `schemaVersion must be ${SCHEMA_VERSION}`,
    );
  }
  if (input.canonicalizationVersion !== CANONICALIZATION_VERSION) {
    throw contractError(
      "INVALID_INPUT",
      `canonicalizationVersion must be ${CANONICALIZATION_VERSION}`,
    );
  }
  return input as unknown as TraceEventEnvelope;
}

export function requireEventId(value: string): string {
  requireUuid(value, "eventId");
  return value;
}

export function requireEntityType(
  value: string,
): TraceEventEnvelope["entityType"] {
  requireEnum(value, ENTITY_TYPES, "entityType");
  return value as TraceEventEnvelope["entityType"];
}

export function requireEntityId(value: string): string {
  requireUuid(value, "entityId");
  return value;
}

function requireEntityContext(input: Record<string, unknown>): void {
  if (
    ["PRODUCTION_CYCLE", "CARE", "SENSOR", "SENSOR_DIGEST", "HARVEST"].includes(
      String(input.entityType),
    ) &&
    !input.cycleId
  ) {
    throw contractError(
      "INVALID_INPUT",
      `${input.entityType} requires cycleId`,
    );
  }
  if (
    ["LOT", "SHIPMENT", "SHIPMENT_TELEMETRY", "INSPECTION"].includes(
      String(input.entityType),
    ) &&
    !input.lotId
  ) {
    throw contractError("INVALID_INPUT", `${input.entityType} requires lotId`);
  }
  if (input.entityType === "CERTIFICATE" && !input.cycleId && !input.lotId) {
    throw contractError(
      "INVALID_INPUT",
      "CERTIFICATE requires cycleId or lotId",
    );
  }
}

function optionalUuid(value: unknown, label: string): void {
  if (value !== undefined) requireUuid(value, label);
}

function requireUuid(value: unknown, label: string): asserts value is string {
  requireMatch(value, UUID, `${label} must be a UUID`);
}

function requireEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): asserts value is T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw contractError("INVALID_INPUT", `${label} is not supported`);
  }
}

function requireMatch(
  value: unknown,
  pattern: RegExp,
  message: string,
): asserts value is string {
  if (typeof value !== "string" || !pattern.test(value))
    throw contractError("INVALID_INPUT", message);
}

function requireDateTime(
  value: unknown,
  label: string,
): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)
  ) {
    throw contractError("INVALID_INPUT", `${label} must be UTC RFC 3339`);
  }
  if (
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw contractError("INVALID_INPUT", `${label} is not a real timestamp`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
