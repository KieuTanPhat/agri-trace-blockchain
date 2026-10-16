import {
  createHash,
  createPublicKey,
  verify as verifySignature,
} from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import {
  privateBodyDigest,
  unsignedBindingBody,
  type BindingEventContext,
} from './binding-commitment.js';
import type { TraceHashInput } from './trace-hash.js';

/** Release C protocol (independent organization signatures). Every constant
 * and byte layout mirrors blockchain/chaincode/src/signing.ts; the shared
 * vectors in signed-commitment.spec.ts lock the two implementations. */
export const C_ENVELOPE_VERSION = '6.0.0';
export const C_SCHEMA_VERSION = '5.0.0';
export const LEGACY_C_ENVELOPE_VERSION = '5.0.0';
export const LEGACY_C_SCHEMA_VERSION = '4.0.0';
export const SIGNED_EVENT_DOMAIN = 'agritrace:binding-event:c1';
export const INTENT_SIGNATURE_DOMAIN = 'agritrace:intent-signature:c1';
export const KEY_POP_DOMAIN = 'agritrace:signing-key-pop:c1';
export const ASSERTION_DOMAIN = 'agritrace:signature-assertion:c1';
export const INTENT_DOMAIN = 'agritrace:intent:c1';
export const INTENT_PAYLOAD_DOMAIN = 'agritrace:intent-payload:c1';
export const INTENT_PROTOCOL = 'agritrace-intent/2';
export const LEGACY_INTENT_PROTOCOL = 'agritrace-intent/1';
export const SIGNING_POLICY_VERSION = '2';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export type EventSignature = {
  keyRef: string;
  intentDigest: string;
  assertionDigest: string;
  /** Present together on c2; absent only when reading historical c1. */
  payloadDigest?: string;
  metadataDigest?: string;
};

export type SignatureAssertion = {
  algorithm: 'Ed25519';
  keyRef: string;
  intentDigest: string;
  signature: string;
  payloadDigest?: string;
};

/** Intent body: every value is a string so the canonical form is trivial for
 * any signer (browser, CLI, remote service) to reproduce independently. */
export type IntentBody = {
  protocol: typeof INTENT_PROTOCOL | typeof LEGACY_INTENT_PROTOCOL;
  intentId: string;
  chainRef: string;
  bindingDigest: string;
  signerOrgRef: string;
  keyRef: string;
  operation: string;
  entityType: string;
  entityId: string;
  eventId: string;
  eventType: string;
  expectedVersion: string;
  payloadDigest: string;
  notAfter: string;
  policyVersion: string;
};

export type IntentPayload = Record<string, string>;

const withDomain = (domain: string, body: string): Buffer =>
  Buffer.concat([
    Buffer.from(domain, 'utf8'),
    Buffer.from([0]),
    Buffer.from(body, 'utf8'),
  ]);

const sha256 = (value: Buffer): string =>
  createHash('sha256').update(value).digest('hex');

function b64url(value: unknown, label: string, bytes?: number): Buffer {
  if (typeof value !== 'string' || !B64URL.test(value))
    throw new Error(`${label} must be base64url`);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value)
    throw new Error(`${label} is not canonical base64url`);
  if (bytes !== undefined && decoded.length !== bytes)
    throw new Error(`${label} must decode to ${bytes} bytes`);
  return decoded;
}

/** Ed25519 SPKI (44 bytes, fixed prefix) -> KeyObject. */
export function parseEd25519PublicKey(publicKey: string) {
  const der = b64url(publicKey, 'publicKey', 44);
  if (!der.subarray(0, 12).equals(ED25519_SPKI_PREFIX))
    throw new Error('publicKey must be an Ed25519 SPKI key');
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export const publicKeyHash = (publicKey: string): string =>
  sha256(b64url(publicKey, 'publicKey', 44));

export function verifyEd25519(
  publicKey: string,
  message: Buffer,
  signature: string,
): boolean {
  try {
    return verifySignature(
      null,
      message,
      parseEd25519PublicKey(publicKey),
      b64url(signature, 'signature', 64),
    );
  } catch {
    return false;
  }
}

export function keyPopMessage(fields: {
  bindingDigest: string;
  keyRef: string;
  orgRef: string;
  publicKey: string;
}): Buffer {
  return withDomain(
    KEY_POP_DOMAIN,
    canonicalize({
      bindingDigest: fields.bindingDigest,
      keyRef: fields.keyRef,
      orgRef: fields.orgRef,
      algorithm: 'Ed25519',
      publicKey: fields.publicKey,
    }),
  );
}

export function payloadDigest(
  payload: IntentPayload,
  protocol: IntentBody['protocol'] = INTENT_PROTOCOL,
): string {
  for (const [key, value] of Object.entries(payload))
    if (typeof value !== 'string')
      throw new Error(`Intent payload field ${key} must be a string`);
  return sha256(
    withDomain(
      protocol === INTENT_PROTOCOL
        ? 'agritrace:intent-payload:c2'
        : INTENT_PAYLOAD_DOMAIN,
      canonicalize(payload),
    ),
  );
}

const INTENT_KEYS: Array<keyof IntentBody> = [
  'protocol',
  'intentId',
  'chainRef',
  'bindingDigest',
  'signerOrgRef',
  'keyRef',
  'operation',
  'entityType',
  'entityId',
  'eventId',
  'eventType',
  'expectedVersion',
  'payloadDigest',
  'notAfter',
  'policyVersion',
];

export function assertIntentBody(intent: IntentBody): void {
  if (
    Object.keys(intent).length !== INTENT_KEYS.length ||
    INTENT_KEYS.some((key) => typeof intent[key] !== 'string')
  )
    throw new Error('Intent has an unexpected shape');
  if (![INTENT_PROTOCOL, LEGACY_INTENT_PROTOCOL].includes(intent.protocol))
    throw new Error('Intent protocol');
  if (
    intent.policyVersion !== (intent.protocol === INTENT_PROTOCOL ? '2' : '1')
  )
    throw new Error('Intent policy version');
  for (const key of [
    'intentId',
    'chainRef',
    'signerOrgRef',
    'keyRef',
    'entityId',
    'eventId',
  ] as const)
    if (!UUID.test(intent[key])) throw new Error(`Intent ${key} is not a uuid`);
  for (const key of ['bindingDigest', 'payloadDigest'] as const)
    if (!HASH.test(intent[key])) throw new Error(`Intent ${key} is not a hash`);
  if (!/^(0|[1-9][0-9]{0,9})$/.test(intent.expectedVersion))
    throw new Error('Intent expectedVersion is not canonical');
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(intent.notAfter) ||
    new Date(intent.notAfter).toISOString() !== intent.notAfter
  )
    throw new Error('Intent notAfter must be a UTC millisecond timestamp');
}

export function intentDigest(intent: IntentBody): string {
  assertIntentBody(intent);
  return sha256(
    withDomain(
      intent.protocol === INTENT_PROTOCOL
        ? 'agritrace:intent:c2'
        : INTENT_DOMAIN,
      canonicalize(intent),
    ),
  );
}

export type IntentSignedFields = {
  intentDigest: string;
  chainRef: string;
  eventId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  bindingDigest: string;
  keyRef: string;
  payloadDigest?: string;
};

/** The bytes the organization key signs. They repeat the event's public
 * identity so a valid signature cannot be moved to another event, entity,
 * chain, binding or key. */
export function intentSignedMessage(fields: IntentSignedFields): Buffer {
  return withDomain(
    fields.payloadDigest === undefined
      ? INTENT_SIGNATURE_DOMAIN
      : 'agritrace:intent-signature:c2',
    canonicalize({
      intentDigest: fields.intentDigest,
      chainRef: fields.chainRef,
      eventId: fields.eventId,
      entityType: fields.entityType,
      entityId: fields.entityId,
      eventType: fields.eventType,
      bindingDigest: fields.bindingDigest,
      keyRef: fields.keyRef,
      ...(fields.payloadDigest === undefined
        ? {}
        : { payloadDigest: fields.payloadDigest }),
    }),
  );
}

export function signedMessageForIntent(intent: IntentBody): Buffer {
  return intentSignedMessage({
    intentDigest: intentDigest(intent),
    chainRef: intent.chainRef,
    eventId: intent.eventId,
    entityType: intent.entityType,
    entityId: intent.entityId,
    eventType: intent.eventType,
    bindingDigest: intent.bindingDigest,
    keyRef: intent.keyRef,
    ...(intent.protocol === INTENT_PROTOCOL
      ? { payloadDigest: intent.payloadDigest }
      : {}),
  });
}

export function assertionDigest(assertion: SignatureAssertion): string {
  return sha256(
    withDomain(
      assertion.payloadDigest === undefined
        ? ASSERTION_DOMAIN
        : 'agritrace:signature-assertion:c2',
      canonicalize({
        algorithm: assertion.algorithm,
        keyRef: assertion.keyRef,
        intentDigest: assertion.intentDigest,
        signature: assertion.signature,
        ...(assertion.payloadDigest === undefined
          ? {}
          : { payloadDigest: assertion.payloadDigest }),
      }),
    ),
  );
}

/** C2 dataHash covers the public body and content commitments (6.0.0/5.0.0).
 * The three-field c1 layout is retained only for historical verification. */
export function signedBindingEventCommitment(
  context: BindingEventContext,
  bodyDigest: string,
  signature: EventSignature,
): string {
  for (const key of ['intentDigest', 'assertionDigest'] as const)
    if (!HASH.test(signature[key])) throw new Error(`Invalid ${key}`);
  if (!UUID.test(signature.keyRef)) throw new Error('Invalid keyRef');
  const c2 = signature.payloadDigest !== undefined;
  if (c2 !== (signature.metadataDigest !== undefined))
    throw new Error('Incomplete c2 signature');
  if (
    c2 &&
    signedPrivateBodyDigest(signature as Required<EventSignature>) !==
      bodyDigest
  )
    throw new Error(
      'Signed private body does not match its content commitments',
    );
  const body = unsignedBindingBody(context, bodyDigest, {
    envelope: c2 ? C_ENVELOPE_VERSION : LEGACY_C_ENVELOPE_VERSION,
    schema: c2 ? C_SCHEMA_VERSION : LEGACY_C_SCHEMA_VERSION,
  });
  return sha256(
    withDomain(
      c2 ? 'agritrace:binding-event:c2' : SIGNED_EVENT_DOMAIN,
      canonicalize({
        ...body,
        signature: {
          keyRef: signature.keyRef,
          intentDigest: signature.intentDigest,
          assertionDigest: signature.assertionDigest,
          ...(c2
            ? {
                payloadDigest: signature.payloadDigest,
                metadataDigest: signature.metadataDigest,
              }
            : {}),
        },
      }),
    ),
  );
}

/** Exact business content, excluding only platform-owned context fields. */
export function signedBusinessPayload(data: unknown): IntentPayload {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('Signed business data must be an object');
  const payload = Object.fromEntries(
    Object.entries(data).filter(
      ([key]) => !['actorSignature', 'chainId', 'scopeVersion'].includes(key),
    ),
  );
  for (const [key, value] of Object.entries(payload))
    if (typeof value !== 'string')
      throw new Error(`Signed business field ${key} must be a string`);
  return payload as IntentPayload;
}

/** Audit metadata is anchored separately: the signer authorizes the business
 * payload, while execution time, actor fingerprint and predecessor are assigned
 * by the platform. Splitting avoids signing an assertion that contains itself. */
export function signedMetadataDigest(event: TraceHashInput): string {
  const data = event.businessData as Record<string, unknown>;
  const businessData = Object.fromEntries(
    ['chainId', 'scopeVersion']
      .filter((key) => Object.hasOwn(data, key))
      .map((key) => [key, data[key]]),
  );
  return sha256(
    withDomain(
      'agritrace:private-metadata:c2',
      privateBodyDigest({ ...event, businessData }),
    ),
  );
}

export function signedPrivateBodyDigest(parts: {
  payloadDigest: string;
  metadataDigest: string;
  assertionDigest: string;
}): string {
  for (const value of [
    parts.payloadDigest,
    parts.metadataDigest,
    parts.assertionDigest,
  ])
    if (!HASH.test(value)) throw new Error('Invalid content digest');
  return sha256(
    withDomain(
      'agritrace:private-body:c2',
      canonicalize({
        payloadDigest: parts.payloadDigest,
        metadataDigest: parts.metadataDigest,
        assertionDigest: parts.assertionDigest,
      }),
    ),
  );
}
