import { canonicalize } from 'json-canonicalize';
import { verifyEd25519 } from '../trace/signed-commitment.js';

/** Domain-separated message a device signs: domain || 0x00 || RFC 8785(body). */
const DEVICE_INGEST_DOMAIN = 'agritrace:iot-device:1';
/** sentAt outside this window is refused so a captured envelope cannot be replayed later. */
const DEVICE_CLOCK_SKEW_MS = 5 * 60_000;

export function deviceMessage(body: unknown): Buffer {
  const serialized = canonicalize(JSON.parse(JSON.stringify(body)));
  if (serialized === undefined) throw new TypeError('Body cannot be canonicalized');
  return Buffer.concat([
    Buffer.from(DEVICE_INGEST_DOMAIN, 'utf8'),
    Buffer.from([0]),
    Buffer.from(serialized, 'utf8'),
  ]);
}

export function verifyDeviceSignature(
  publicKey: string,
  body: unknown,
  signature: string,
): boolean {
  return verifyEd25519(publicKey, deviceMessage(body), signature);
}

export function sentAtWithinSkew(sentAt: string, now = Date.now()) {
  const t = Date.parse(sentAt);
  return Number.isFinite(t) && Math.abs(t - now) <= DEVICE_CLOCK_SKEW_MS;
}
