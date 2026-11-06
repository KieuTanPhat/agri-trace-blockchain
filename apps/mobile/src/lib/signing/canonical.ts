import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Mobile port of the Web signer's canonical encoding
 * (apps/web/src/lib/signing/canonical.ts and distribution-signer.ts). Every
 * byte must match the API encoder; the signer recomputes digests itself and
 * never trusts the ones the server sends.
 */
type StringMap = Record<string, string>;

const INTENT_PROTOCOL = 'agritrace-intent/2';
const INTENT_DOMAIN = 'agritrace:intent:c2';
const PAYLOAD_DOMAIN = 'agritrace:intent-payload:c2';
const SIGNATURE_DOMAIN = 'agritrace:intent-signature:c2';
const KEY_POP_DOMAIN = 'agritrace:signing-key-pop:c1';
const encoder = new TextEncoder();

function canonicalize(value: StringMap): string {
  const sorted: StringMap = {};
  for (const key of Object.keys(value).sort()) {
    if (typeof value[key] !== 'string') throw new Error(`Giá trị "${key}" phải là chuỗi`);
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

/** Sorted-key JSON of arbitrary values, as in the Web distribution signer. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return '{' + Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
      .join(',') + '}';
  throw new Error('Nội dung ký không hợp lệ');
}

function withDomain(domain: string, body: string): Uint8Array {
  const prefix = encoder.encode(domain);
  const text = encoder.encode(body);
  const out = new Uint8Array(prefix.length + 1 + text.length);
  out.set(prefix, 0);
  out.set(text, prefix.length + 1);
  return out;
}

export const sha256Hex = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

export function fromBase64Url(text: string): Uint8Array {
  const out: number[] = [];
  let bits = 0, value = 0;
  for (const char of text) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Chuỗi base64url không hợp lệ');
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

export const payloadDigest = (payload: StringMap) => sha256Hex(withDomain(PAYLOAD_DOMAIN, canonicalize(payload)));
export const intentDigest = (intent: StringMap) => sha256Hex(withDomain(INTENT_DOMAIN, canonicalize(intent)));

/** The exact bytes the organization key signs for a c2 intent. */
export function signedMessage(intent: StringMap): Uint8Array {
  return withDomain(SIGNATURE_DOMAIN, canonicalize({
    intentDigest: intentDigest(intent),
    chainRef: intent.chainRef,
    eventId: intent.eventId,
    entityType: intent.entityType,
    entityId: intent.entityId,
    eventType: intent.eventType,
    bindingDigest: intent.bindingDigest,
    keyRef: intent.keyRef,
    payloadDigest: intent.payloadDigest,
  }));
}

export function keyPopMessage(fields: { bindingDigest: string; keyRef: string; orgRef: string; publicKey: string }) {
  return withDomain(KEY_POP_DOMAIN, canonicalize({
    bindingDigest: fields.bindingDigest,
    keyRef: fields.keyRef,
    orgRef: fields.orgRef,
    algorithm: 'Ed25519',
    publicKey: fields.publicKey,
  }));
}

// Ed25519 SubjectPublicKeyInfo header; the raw 32-byte key follows.
const SPKI = Uint8Array.from([0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00]);
/** SPKI DER of a raw Ed25519 public key, the form the API enrolls. */
export function ed25519Spki(raw: Uint8Array) {
  const out = new Uint8Array(SPKI.length + raw.length);
  out.set(SPKI, 0);
  out.set(raw, SPKI.length);
  return out;
}

/** Digest a transfer snapshot carries for its pickup and delivery photos. */
export function handoverPhotosDigest(transferId: string, photos: { phase: string; evidenceId: string; sha256: string }[]) {
  const sorted = photos
    .map((p) => ({ phase: p.phase, evidenceId: p.evidenceId, sha256: p.sha256 }))
    .sort((a, b) => a.phase.localeCompare(b.phase) || a.evidenceId.localeCompare(b.evidenceId));
  return sha256Hex(new TextEncoder().encode(canonicalJson({ transferId, photos: sorted })));
}

/** Messages of the standard (non-c2) distribution protocol: domain NUL json. */
export const distributionMessage = (domain: string, body: unknown) => encoder.encode(domain + '\0' + canonicalJson(body));

export type PreparedIntent = {
  intentId: string;
  operation: string;
  keyRef: string;
  expiresAt: string;
  intent: StringMap;
  payload: StringMap;
  intentDigest: string;
  signedMessage: string;
};

/** Re-derives everything the server claims about a prepared intent. */
export function verifyPreparedIntent(prepared: PreparedIntent, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  const { intent, payload } = prepared;
  try {
    if (intent.protocol !== INTENT_PROTOCOL || intent.policyVersion !== '2')
      return { ok: false, reason: 'Giao thức ký không được hỗ trợ' };
    if (payloadDigest(payload) !== intent.payloadDigest)
      return { ok: false, reason: 'Nội dung hiển thị không khớp nội dung sẽ ký' };
    if (intentDigest(intent) !== prepared.intentDigest)
      return { ok: false, reason: 'Mã băm yêu cầu ký không khớp' };
    if (toBase64Url(signedMessage(intent)) !== prepared.signedMessage)
      return { ok: false, reason: 'Thông điệp ký của máy chủ không khớp' };
    if (intent.keyRef !== prepared.keyRef || intent.intentId !== prepared.intentId
      || intent.operation !== prepared.operation || intent.notAfter !== prepared.expiresAt)
      return { ok: false, reason: 'Yêu cầu ký không khớp khóa hoặc mã yêu cầu' };
    if (!Number.isFinite(Date.parse(intent.notAfter)))
      return { ok: false, reason: 'Thời hạn yêu cầu ký không hợp lệ' };
    if (Date.parse(intent.notAfter) <= now) return { ok: false, reason: 'Yêu cầu ký đã hết hạn' };
  } catch {
    return { ok: false, reason: 'Yêu cầu ký không hợp lệ' };
  }
  return { ok: true };
}
