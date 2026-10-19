import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** RFC 6238 TOTP (HMAC-SHA1, 6 digits, 30 s) on node:crypto. */
export const TOTP_PERIOD_SECONDS = 30;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function hotp(secretBase32: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secretBase32))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Returns the matching time step (so the caller can reject replays of the
 * same or an older step) or null. Accepts +-1 step of clock drift. */
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs = Date.now(),
  window = 1,
): number | null {
  if (!/^\d{6}$/u.test(code)) return null;
  const current = totpStep(nowMs);
  let matched: number | null = null;
  for (let step = current - window; step <= current + window; step += 1) {
    const expected = Buffer.from(hotp(secretBase32, step));
    // Do not short-circuit: keep timing independent of the matching step.
    if (timingSafeEqual(expected, Buffer.from(code))) matched = step;
  }
  return matched;
}

export function otpauthUri(
  secretBase32: string,
  account: string,
  issuer = 'AgriTrace',
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${TOTP_PERIOD_SECONDS}`;
}
