import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';

const FORMAT = 'v1';

/** AES-256-GCM envelope (`v1.` + base64 of `iv(12) | tag(16) | ciphertext`) for secrets
 * that must be recoverable, such as TOTP seeds. The key is a dedicated 32-byte
 * value from PLATFORM_SECRET_KEY (base64 or 64 hex chars); it is never derived
 * from the JWT secret so a JWT-secret rotation cannot orphan stored seeds. */
export function platformSecretKey(
  raw = process.env.PLATFORM_SECRET_KEY,
): Buffer {
  const value = raw?.trim();
  if (!value) throw new Error('PLATFORM_SECRET_KEY is not configured');
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : Buffer.from(value, 'base64');
  if (key.length !== 32)
    throw new Error('PLATFORM_SECRET_KEY must decode to exactly 32 bytes');
  return key;
}

export function sealSecret(
  plaintext: string,
  aad: string,
  key = platformSecretKey(),
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return `${FORMAT}.${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function openSecret(
  sealed: string,
  aad: string,
  key = platformSecretKey(),
): string {
  // The version prefix leaves room to rotate PLATFORM_SECRET_KEY without
  // guessing which key sealed a value.
  const [version, body] = sealed.split('.', 2);
  if (version !== FORMAT || !body) throw new Error('Sealed secret is malformed');
  const packed = Buffer.from(body, 'base64');
  if (packed.length < 29) throw new Error('Sealed secret is malformed');
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([
    decipher.update(packed.subarray(28)),
    decipher.final(),
  ]).toString('utf8');
}

/** Keyed digest for high-entropy random tokens (recovery codes). */
export function keyedDigest(
  purpose: string,
  value: string,
  key = platformSecretKey(),
): string {
  return createHmac('sha256', key)
    .update(`${purpose}\0${value}`, 'utf8')
    .digest('hex');
}
