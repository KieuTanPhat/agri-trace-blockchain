import { describe, expect, it } from 'vitest';
import { openSecret, sealSecret, keyedDigest } from './secret-box.js';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpStep,
  verifyTotp,
} from './totp.js';

// RFC 6238 appendix B, SHA-1 seed "12345678901234567890" (last 6 digits).
const rfcSecret = base32Encode(Buffer.from('12345678901234567890', 'ascii'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC test vector at t=%i', (seconds, code) => {
    expect(hotp(rfcSecret, totpStep(seconds * 1000))).toBe(code);
    expect(verifyTotp(rfcSecret, code, seconds * 1000)).toBe(
      totpStep(seconds * 1000),
    );
  });

  it('accepts one step of drift and rejects anything further or malformed', () => {
    const now = 1234567890_000;
    const step = totpStep(now);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, step - 2), now)).toBeNull();
    expect(verifyTotp(rfcSecret, hotp(rfcSecret, step + 2), now)).toBeNull();
    expect(verifyTotp(rfcSecret, '12345', now)).toBeNull();
    expect(verifyTotp(rfcSecret, 'abcdef', now)).toBeNull();
  });

  it('round-trips base32 and builds an otpauth URI without extra secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/u);
    expect(base32Encode(base32Decode(secret))).toBe(secret);
    const uri = otpauthUri(secret, 'quan.tri@example.test');
    expect(uri).toContain(`secret=${secret}`);
    expect(uri.startsWith('otpauth://totp/AgriTrace%3Aquan.tri%40example.test')).toBe(
      true,
    );
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = Buffer.alloc(32, 9);

  it('seals and opens a secret and never stores plaintext', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', 'platform-mfa:u1', key);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, 'platform-mfa:u1', key)).toBe('JBSWY3DPEHPK3PXP');
    expect(sealSecret('JBSWY3DPEHPK3PXP', 'platform-mfa:u1', key)).not.toBe(
      sealed,
    );
  });

  it('binds the ciphertext to its owner and detects tampering or a wrong key', () => {
    const sealed = sealSecret('seed', 'platform-mfa:u1', key);
    expect(() => openSecret(sealed, 'platform-mfa:u2', key)).toThrow();
    expect(() => openSecret(sealed, 'platform-mfa:u1', Buffer.alloc(32, 1))).toThrow();
    expect(sealed.startsWith('v1.')).toBe(true);
    const bytes = Buffer.from(sealed.slice(3), 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() =>
      openSecret(`v1.${bytes.toString('base64')}`, 'platform-mfa:u1', key),
    ).toThrow();
    expect(() =>
      openSecret(`v9.${bytes.toString('base64')}`, 'platform-mfa:u1', key),
    ).toThrow(/malformed/u);
  });

  it('rejects a missing or wrongly sized key and keys digests by purpose', () => {
    expect(() => sealSecret('x', 'a', undefined as never)).toThrow(/PLATFORM_SECRET_KEY/u);
    expect(keyedDigest('mfa-recovery', 'ABCDE', key)).not.toBe(
      keyedDigest('other', 'ABCDE', key),
    );
    expect(keyedDigest('mfa-recovery', 'ABCDE', key)).toMatch(/^[0-9a-f]{64}$/u);
  });
});
