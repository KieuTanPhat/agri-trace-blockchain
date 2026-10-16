/**
 * Release C signing, browser side. Every rule here mirrors the API encoder
 * (apps/api src/modules/trace/signed-commitment.ts) byte for byte: all intent
 * and payload values are strings, so RFC 8785 canonicalization reduces to
 * sorted keys plus JSON.stringify. The signer never trusts the digests the
 * server sends; it recomputes them from what the user is shown.
 */
export type StringMap = Record<string, string>;

export const INTENT_PROTOCOL = "agritrace-intent/2";
const INTENT_DOMAIN = "agritrace:intent:c2";
const PAYLOAD_DOMAIN = "agritrace:intent-payload:c2";
const SIGNATURE_DOMAIN = "agritrace:intent-signature:c2";
const KEY_POP_DOMAIN = "agritrace:signing-key-pop:c1";
const encoder = new TextEncoder();

export function canonicalize(value: StringMap): string {
  const sorted: StringMap = {};
  for (const key of Object.keys(value).sort()) {
    if (typeof value[key] !== "string")
      throw new Error(`Giá trị "${key}" phải là chuỗi`);
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function withDomain(domain: string, body: string): Uint8Array {
  const prefix = encoder.encode(domain);
  const text = encoder.encode(body);
  const out = new Uint8Array(prefix.length + 1 + text.length);
  out.set(prefix, 0);
  out.set(text, prefix.length + 1);
  return out;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export const payloadDigest = (payload: StringMap) =>
  sha256Hex(withDomain(PAYLOAD_DOMAIN, canonicalize(payload)));

export const intentDigest = (intent: StringMap) =>
  sha256Hex(withDomain(INTENT_DOMAIN, canonicalize(intent)));

/** The exact bytes the organization key signs. */
export async function signedMessage(intent: StringMap): Promise<Uint8Array> {
  return withDomain(
    SIGNATURE_DOMAIN,
    canonicalize({
      intentDigest: await intentDigest(intent),
      chainRef: intent.chainRef,
      eventId: intent.eventId,
      entityType: intent.entityType,
      entityId: intent.entityId,
      eventType: intent.eventType,
      bindingDigest: intent.bindingDigest,
      keyRef: intent.keyRef,
      payloadDigest: intent.payloadDigest,
    }),
  );
}

export function keyPopMessage(fields: {
  bindingDigest: string;
  keyRef: string;
  orgRef: string;
  publicKey: string;
}): Uint8Array {
  return withDomain(
    KEY_POP_DOMAIN,
    canonicalize({
      bindingDigest: fields.bindingDigest,
      keyRef: fields.keyRef,
      orgRef: fields.orgRef,
      algorithm: "Ed25519",
      publicKey: fields.publicKey,
    }),
  );
}

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

export type IntentCheck = { ok: true } | { ok: false; reason: string };

/**
 * Re-derives everything the server claims about a prepared intent. A signer
 * calls this before it signs, so a server (or a network attacker) cannot make
 * the user sign something other than the payload that was displayed.
 */
export async function verifyPreparedIntent(
  prepared: PreparedIntent,
  now = Date.now(),
): Promise<IntentCheck> {
  const { intent, payload } = prepared;
  try {
    if (intent.protocol !== INTENT_PROTOCOL || intent.policyVersion !== "2")
      return { ok: false, reason: "Giao thức ký không được hỗ trợ" };
    if ((await payloadDigest(payload)) !== intent.payloadDigest)
      return {
        ok: false,
        reason: "Nội dung hiển thị không khớp nội dung sẽ ký",
      };
    if ((await intentDigest(intent)) !== prepared.intentDigest)
      return { ok: false, reason: "Mã băm yêu cầu ký không khớp" };
    if (toBase64Url(await signedMessage(intent)) !== prepared.signedMessage)
      return { ok: false, reason: "Thông điệp ký của máy chủ không khớp" };
    if (
      intent.keyRef !== prepared.keyRef ||
      intent.intentId !== prepared.intentId ||
      intent.operation !== prepared.operation ||
      intent.notAfter !== prepared.expiresAt
    )
      return {
        ok: false,
        reason: "Yêu cầu ký không khớp khóa hoặc mã yêu cầu",
      };
    if (!Number.isFinite(Date.parse(intent.notAfter)))
      return { ok: false, reason: "Thời hạn yêu cầu ký không hợp lệ" };
    if (Date.parse(intent.notAfter) <= now)
      return { ok: false, reason: "Yêu cầu ký đã hết hạn" };
  } catch {
    return { ok: false, reason: "Yêu cầu ký không hợp lệ" };
  }
  return { ok: true };
}
