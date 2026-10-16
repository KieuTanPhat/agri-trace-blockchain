import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalize } from "json-canonicalize";

import {
  B_ENVELOPE_VERSION,
  parseBindingEventBody,
  parseStrictJson,
  requireExactKeys,
  requireHash,
  requireUuid,
  unsignedBindingBody,
  type BindingEventInput,
} from "./binding";
import { contractError } from "./errors";

/** Release C protocol constants. The API encoder must match byte for byte;
 * test/signing.spec.ts and apps/api binding-commitment.spec.ts share vectors. */
export const C_ENVELOPE_VERSION = "6.0.0";
export const C_SCHEMA_VERSION = "5.0.0";
export const SIGNED_EVENT_DOMAIN = "agritrace:binding-event:c1";
export const INTENT_SIGNATURE_DOMAIN = "agritrace:intent-signature:c1";
export const KEY_POP_DOMAIN = "agritrace:signing-key-pop:c1";
export const ASSERTION_DOMAIN = "agritrace:signature-assertion:c1";
export const SIGNING_PROTOCOL = "agritrace-signing/1";

/** Event types that change custody between organizations and therefore may
 * only be recorded with an independent organization signature. */
export const SIGNATURE_REQUIRED_EVENT_TYPES: readonly string[] = [
  "HANDOVER_OFFERED",
  "HANDOVER_CONFIRMED",
];

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const B64URL = /^[A-Za-z0-9_-]+$/;

export interface EventSignature {
  keyRef: string;
  intentDigest: string;
  assertionDigest: string;
  payloadDigest?: string;
  metadataDigest?: string;
}

export interface SignedBindingEventInput extends BindingEventInput {
  signature: EventSignature;
}

export interface SignatureAssertion {
  algorithm: "Ed25519";
  keyRef: string;
  intentDigest: string;
  signature: string;
  payloadDigest?: string;
}

function b64url(value: unknown, label: string, bytes?: number): Buffer {
  if (typeof value !== "string" || !B64URL.test(value))
    throw contractError("INVALID_INPUT", `${label} must be base64url`);
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value)
    throw contractError("INVALID_INPUT", `${label} is not canonical base64url`);
  if (bytes !== undefined && decoded.length !== bytes)
    throw contractError("INVALID_INPUT", `${label} must decode to ${bytes} bytes`);
  return decoded;
}

/** Parses an Ed25519 SPKI DER public key (44 bytes, fixed prefix). */
export function parseEd25519PublicKey(publicKey: unknown, label = "publicKey") {
  const der = b64url(publicKey, label, 44);
  if (!der.subarray(0, 12).equals(ED25519_SPKI_PREFIX))
    throw contractError("INVALID_INPUT", `${label} must be an Ed25519 SPKI key`);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function verifyEd25519(publicKey: string, message: Buffer, signature: string): boolean {
  const sig = b64url(signature, "signature", 64);
  try {
    return verify(null, message, parseEd25519PublicKey(publicKey), sig);
  } catch {
    return false;
  }
}

const bytesWithDomain = (domain: string, body: string) =>
  Buffer.concat([Buffer.from(domain, "utf8"), Buffer.from([0]), Buffer.from(body, "utf8")]);

export interface KeyPopFields {
  bindingDigest: string;
  keyRef: string;
  orgRef: string;
  algorithm: "Ed25519";
  publicKey: string;
}

/** The registrant proves possession of the private key by signing exactly
 * this message; the key therefore cannot be enrolled by someone who only
 * observed the public key. */
export function keyPopMessage(fields: KeyPopFields): Buffer {
  return bytesWithDomain(
    KEY_POP_DOMAIN,
    canonicalize({
      bindingDigest: fields.bindingDigest,
      keyRef: fields.keyRef,
      orgRef: fields.orgRef,
      algorithm: fields.algorithm,
      publicKey: fields.publicKey,
    }),
  );
}

export interface IntentSignedFields {
  intentDigest: string;
  chainRef: string;
  eventId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  bindingDigest: string;
  keyRef: string;
  payloadDigest?: string;
}

/** What the organization key signs. It repeats the public identity of the
 * event so a valid signature cannot be moved to another event, entity, chain,
 * binding or key even though the ledger never sees the private intent. */
export function intentSignedMessage(fields: IntentSignedFields): Buffer {
  return bytesWithDomain(
    fields.payloadDigest === undefined ? INTENT_SIGNATURE_DOMAIN : "agritrace:intent-signature:c2",
    canonicalize({
      intentDigest: fields.intentDigest,
      chainRef: fields.chainRef,
      eventId: fields.eventId,
      entityType: fields.entityType,
      entityId: fields.entityId,
      eventType: fields.eventType,
      bindingDigest: fields.bindingDigest,
      keyRef: fields.keyRef,
      ...(fields.payloadDigest === undefined ? {} : { payloadDigest: fields.payloadDigest }),
    }),
  );
}

export function assertionDigest(assertion: SignatureAssertion): string {
  return createHash("sha256")
    .update(
      bytesWithDomain(
        assertion.payloadDigest === undefined ? ASSERTION_DOMAIN : "agritrace:signature-assertion:c2",
        canonicalize({
          algorithm: assertion.algorithm,
          keyRef: assertion.keyRef,
          intentDigest: assertion.intentDigest,
          signature: assertion.signature,
          ...(assertion.payloadDigest === undefined ? {} : { payloadDigest: assertion.payloadDigest }),
        }),
      ),
    )
    .digest("hex");
}

export function signedEventBody(event: SignedBindingEventInput) {
  return { ...unsignedBindingBody(event), signature: event.signature };
}

export function signedBindingEventCommitment(event: SignedBindingEventInput): string {
  return createHash("sha256")
    .update(bytesWithDomain(event.envelopeVersion === C_ENVELOPE_VERSION ? "agritrace:binding-event:c2" : SIGNED_EVENT_DOMAIN, canonicalize(signedEventBody(event))))
    .digest("hex");
}

export function parseSignedBindingEvent(json: string): SignedBindingEventInput {
  const input = parseStrictJson(json, "SignedBindingEvent");
  requireExactKeys(
    input,
    [
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
      "signature",
    ],
    "SignedBindingEvent",
  );
  const { signature, ...rest } = input;
  const body = parseBindingEventBody(rest, C_ENVELOPE_VERSION, C_SCHEMA_VERSION);
  if (typeof signature !== "object" || signature === null || Array.isArray(signature))
    throw contractError("INVALID_INPUT", "signature must be an object");
  const sig = signature as Record<string, unknown>;
  requireExactKeys(sig, ["keyRef", "intentDigest", "assertionDigest", "payloadDigest", "metadataDigest"], "signature");
  return {
    ...body,
    signature: {
      keyRef: requireUuid(sig.keyRef, "signature.keyRef"),
      intentDigest: requireHash(sig.intentDigest, "signature.intentDigest"),
      assertionDigest: requireHash(sig.assertionDigest, "signature.assertionDigest"),
      payloadDigest: requireHash(sig.payloadDigest, "signature.payloadDigest"),
      metadataDigest: requireHash(sig.metadataDigest, "signature.metadataDigest"),
    },
  };
}

export function parseSignatureAssertion(json: string): SignatureAssertion {
  const input = parseStrictJson(json, "SignatureAssertion");
  requireExactKeys(input, ["algorithm", "keyRef", "intentDigest", "signature", "payloadDigest"], "SignatureAssertion");
  if (input.algorithm !== "Ed25519")
    throw contractError("INVALID_INPUT", "algorithm must be Ed25519");
  b64url(input.signature, "signature", 64);
  return {
    algorithm: "Ed25519",
    keyRef: requireUuid(input.keyRef, "keyRef"),
    intentDigest: requireHash(input.intentDigest, "intentDigest"),
    signature: input.signature as string,
    payloadDigest: requireHash(input.payloadDigest, "payloadDigest"),
  };
}

/** Rebuild the private commitment from the signed content and audit metadata.
 * A relayer cannot attach an arbitrary private digest to a valid signature. */
export function signedPrivateBodyDigest(parts: EventSignature): string {
  const body = {
    payloadDigest: requireHash(parts.payloadDigest, "payloadDigest"),
    metadataDigest: requireHash(parts.metadataDigest, "metadataDigest"),
    assertionDigest: requireHash(parts.assertionDigest, "assertionDigest"),
  };
  return createHash("sha256").update(bytesWithDomain("agritrace:private-body:c2", canonicalize(body))).digest("hex");
}

/** Validates the registration payload fields shared by proposal and execution. */
export function parseKeyRegistration(payload: Record<string, unknown>): KeyPopFields & { popSignature: string } {
  requireExactKeys(
    payload,
    ["bindingDigest", "keyRef", "orgRef", "algorithm", "publicKey", "popSignature"],
    "SIGNING_KEY_REGISTER",
  );
  if (payload.algorithm !== "Ed25519")
    throw contractError("INVALID_INPUT", "algorithm must be Ed25519");
  const fields: KeyPopFields = {
    bindingDigest: requireHash(payload.bindingDigest, "bindingDigest"),
    keyRef: requireUuid(payload.keyRef, "keyRef"),
    orgRef: requireUuid(payload.orgRef, "orgRef"),
    algorithm: "Ed25519",
    publicKey: payload.publicKey as string,
  };
  parseEd25519PublicKey(fields.publicKey);
  const popSignature = payload.popSignature as string;
  if (!verifyEd25519(fields.publicKey, keyPopMessage(fields), popSignature))
    throw contractError("SIGNATURE_INVALID", "proof of possession does not verify");
  return { ...fields, popSignature };
}

export { B_ENVELOPE_VERSION };
