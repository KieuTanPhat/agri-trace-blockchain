import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

import { contractError } from "./errors";
import { ENTITY_TYPES, EVENT_TYPES, type EntityType } from "./types";

/** Release B protocol constants. They must match the API encoder byte for
 * byte; shared vectors in test/binding.spec.ts lock both implementations. */
export const BINDING_PROTOCOL = "agritrace-fabric-binding/1";
export const B_ENVELOPE_VERSION = "4.0.0";
export const B_SCHEMA_VERSION = "3.0.0";
export const BINDING_EVENT_DOMAIN = "agritrace:binding-event:b1";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const INT64_MAX = 9223372036854775807n;
const MAX_JSON_BYTES = 16 * 1024;

export interface BindingTuple {
  network: string;
  channelId: string;
  chaincodeName: string;
  contractName: string;
  chainRef: string;
  envelopeVersion: string;
  writerAuthority: string;
  writerMspId: string;
  writerRole: string;
  governanceDigest: string;
}

export interface PermissionRef {
  permissionRef: string;
  epoch: string;
  ordinal: string;
}

export interface BindingEventInput {
  envelopeVersion: string;
  schemaVersion: string;
  canonicalizationVersion: string;
  eventId: string;
  nonce: string;
  entityType: string;
  entityId: string;
  cycleId: string | null;
  lotId: string | null;
  eventType: string;
  eventTime: string;
  previousEventHash: string | null;
  privateBodyDigest: string;
  bindingDigest: string;
  chainRef: string;
  permissions: PermissionRef[];
  dataHash: string;
}

const EVENT_KEYS = [
  "envelopeVersion",
  "schemaVersion",
  "canonicalizationVersion",
  "eventId",
  "nonce",
  "entityType",
  "entityId",
  "cycleId",
  "lotId",
  "eventType",
  "eventTime",
  "previousEventHash",
  "privateBodyDigest",
  "bindingDigest",
  "chainRef",
  "permissions",
  "dataHash",
] as const;

export function parseStrictJson(
  json: string,
  label: string,
): Record<string, unknown> {
  if (typeof json !== "string" || Buffer.byteLength(json, "utf8") > MAX_JSON_BYTES)
    throw contractError("INVALID_INPUT", `${label} is missing or too large`);
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw contractError("INVALID_INPUT", `${label} must be valid JSON`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw contractError("INVALID_INPUT", `${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

export function requireExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length)
    throw contractError("INVALID_INPUT", `${label}: unknown field ${unknown[0]}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length)
    throw contractError("INVALID_INPUT", `${label}: missing field ${missing[0]}`);
}

export function requireHash(value: unknown, label: string): string {
  if (typeof value !== "string" || !HASH.test(value))
    throw contractError("INVALID_INPUT", `${label} must be lowercase SHA-256 hex`);
  return value;
}

export function requireUuid(value: unknown, label: string): string {
  if (typeof value !== "string" || !UUID.test(value))
    throw contractError("INVALID_INPUT", `${label} must be a lowercase UUID`);
  return value;
}

export function requireEntityType(value: unknown): EntityType {
  if (typeof value !== "string" || !(ENTITY_TYPES as readonly string[]).includes(value))
    throw contractError("INVALID_INPUT", "entityType is not supported");
  return value as EntityType;
}

export function requireName(value: unknown, label: string): string {
  if (typeof value !== "string" || !NAME.test(value))
    throw contractError("INVALID_INPUT", `${label} is not a valid name`);
  return value;
}

/** Canonical positive decimal string within int64; never a JS float. */
export function canonicalPositiveInt(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,18}$/.test(value))
    throw contractError("INVALID_INPUT", `${label} must be a canonical positive integer string`);
  if (BigInt(value) > INT64_MAX)
    throw contractError("INVALID_INPUT", `${label} exceeds int64`);
  return value;
}

export function canonicalNonNegativeInt(value: unknown, label: string): string {
  if (value === "0") return "0";
  return canonicalPositiveInt(value, label);
}

function nullableUuid(value: unknown, label: string): string | null {
  return value === null ? null : requireUuid(value, label);
}

function requireDateTime(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw contractError("INVALID_INPUT", `${label} must be a UTC millisecond ISO timestamp`);
  return value;
}

export function parseBindingEvent(json: string): BindingEventInput {
  const input = parseStrictJson(json, "BindingEvent");
  requireExactKeys(input, EVENT_KEYS, "BindingEvent");
  return parseBindingEventBody(input, B_ENVELOPE_VERSION, B_SCHEMA_VERSION);
}

/** Shared by release B (4.0.0/3.0.0) and C (5.0.0/4.0.0); the caller has
 * already checked the exact key set for its envelope version. */
export function parseBindingEventBody(
  input: Record<string, unknown>,
  envelopeVersion: string,
  schemaVersion: string,
): BindingEventInput {
  if (input.envelopeVersion !== envelopeVersion)
    throw contractError("INVALID_INPUT", `envelopeVersion must be ${envelopeVersion}`);
  if (input.schemaVersion !== schemaVersion)
    throw contractError("INVALID_INPUT", `schemaVersion must be ${schemaVersion}`);
  if (input.canonicalizationVersion !== "RFC8785")
    throw contractError("INVALID_INPUT", "canonicalizationVersion must be RFC8785");
  const eventId = requireUuid(input.eventId, "eventId");
  if (input.nonce !== eventId)
    throw contractError("INVALID_INPUT", "nonce must equal eventId");
  if (typeof input.entityType !== "string" || !(ENTITY_TYPES as readonly string[]).includes(input.entityType))
    throw contractError("INVALID_INPUT", "entityType is not supported");
  if (typeof input.eventType !== "string" || !(EVENT_TYPES as readonly string[]).includes(input.eventType))
    throw contractError("INVALID_INPUT", "eventType is not supported");
  if (!Array.isArray(input.permissions) || input.permissions.length < 1 || input.permissions.length > 16)
    throw contractError("INVALID_INPUT", "permissions must contain 1-16 entries");
  const permissions = input.permissions.map((item: unknown, index: number) => {
    const entry = parseObject(item, `permissions[${index}]`);
    requireExactKeys(entry, ["permissionRef", "epoch", "ordinal"], `permissions[${index}]`);
    return {
      permissionRef: requireUuid(entry.permissionRef, "permissionRef"),
      epoch: canonicalPositiveInt(entry.epoch, "epoch"),
      ordinal: canonicalPositiveInt(entry.ordinal, "ordinal"),
    };
  });
  for (let i = 1; i < permissions.length; i += 1)
    if (permissions[i - 1].permissionRef >= permissions[i].permissionRef)
      throw contractError("INVALID_INPUT", "permissions must be sorted and unique by permissionRef");
  return {
    envelopeVersion,
    schemaVersion,
    canonicalizationVersion: "RFC8785",
    eventId,
    nonce: eventId,
    entityType: input.entityType,
    entityId: requireUuid(input.entityId, "entityId"),
    cycleId: nullableUuid(input.cycleId, "cycleId"),
    lotId: nullableUuid(input.lotId, "lotId"),
    eventType: input.eventType,
    eventTime: requireDateTime(input.eventTime, "eventTime"),
    previousEventHash: input.previousEventHash === null ? null : requireHash(input.previousEventHash, "previousEventHash"),
    privateBodyDigest: requireHash(input.privateBodyDigest, "privateBodyDigest"),
    bindingDigest: requireHash(input.bindingDigest, "bindingDigest"),
    chainRef: requireUuid(input.chainRef, "chainRef"),
    permissions,
    dataHash: requireHash(input.dataHash, "dataHash"),
  };
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw contractError("INVALID_INPUT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

export function bindingDigest(binding: BindingTuple): string {
  for (const field of [
    "network",
    "channelId",
    "chaincodeName",
    "contractName",
    "writerAuthority",
    "writerMspId",
    "writerRole",
  ] as const)
    requireName(binding[field], field);
  requireUuid(binding.chainRef, "chainRef");
  requireHash(binding.governanceDigest, "governanceDigest");
  if (binding.envelopeVersion !== B_ENVELOPE_VERSION)
    throw contractError("INVALID_INPUT", "binding requires envelope 4.0.0");
  if (binding.writerRole !== "relayer")
    throw contractError("INVALID_INPUT", "binding writer must be a relayer");
  return sha256(
    canonicalize({
      protocol: BINDING_PROTOCOL,
      network: binding.network,
      channelId: binding.channelId,
      chaincodeName: binding.chaincodeName,
      contractName: binding.contractName,
      chainRef: binding.chainRef,
      envelopeVersion: binding.envelopeVersion,
      writerAuthority: binding.writerAuthority,
      writerMspId: binding.writerMspId,
      writerRole: binding.writerRole,
      governanceDigest: binding.governanceDigest,
    }),
  );
}

export function parseBindingTuple(value: unknown): BindingTuple {
  const input = parseObject(value, "binding");
  requireExactKeys(
    input,
    [
      "network",
      "channelId",
      "chaincodeName",
      "contractName",
      "chainRef",
      "envelopeVersion",
      "writerAuthority",
      "writerMspId",
      "writerRole",
      "governanceDigest",
    ],
    "binding",
  );
  return input as unknown as BindingTuple;
}

/** The public unsigned body committed to by dataHash. */
export function unsignedBindingBody(event: BindingEventInput) {
  return {
    envelopeVersion: event.envelopeVersion,
    schemaVersion: event.schemaVersion,
    canonicalizationVersion: event.canonicalizationVersion,
    eventId: event.eventId,
    nonce: event.nonce,
    entityType: event.entityType,
    entityId: event.entityId,
    cycleId: event.cycleId,
    lotId: event.lotId,
    eventType: event.eventType,
    eventTime: event.eventTime,
    previousEventHash: event.previousEventHash,
    privateBodyDigest: event.privateBodyDigest,
    bindingDigest: event.bindingDigest,
    chainRef: event.chainRef,
    permissions: event.permissions,
  };
}

export function bindingEventCommitment(event: BindingEventInput): string {
  return createHash("sha256")
    .update(BINDING_EVENT_DOMAIN, "utf8")
    .update(Buffer.from([0]))
    .update(canonicalize(unsignedBindingBody(event)), "utf8")
    .digest("hex");
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
