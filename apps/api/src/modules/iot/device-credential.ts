import { createHash, timingSafeEqual } from 'node:crypto';
import { isUUID } from 'class-validator';

export interface DeviceCredentialSnapshot {
  id: string;
  deviceId: string;
  verifier: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Authentication primitive only: caller must still lock/recheck org, device,
 * grant/assignment, credential revision and session before writes and replay. */
export function matchesDeviceCredential(
  token: string,
  deviceId: string,
  credential: DeviceCredentialSnapshot,
  now: Date,
): boolean {
  if (
    !Number.isFinite(now.getTime()) ||
    !Number.isFinite(credential.expiresAt.getTime()) ||
    credential.revokedAt !== null ||
    credential.expiresAt <= now ||
    !isUUID(deviceId) ||
    deviceId !== deviceId.toLowerCase() ||
    credential.deviceId !== deviceId ||
    credential.verifier.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(credential.verifier)
  )
    return false;
  // A canonical UUID and a 32..64-byte base64url secret. Never log or journal token.
  const match = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43,86})$/.exec(token);
  if (
    !match ||
    match[0] !== token ||
    !isUUID(match[1]) ||
    match[1] !== credential.id
  )
    return false;
  const bytes = Buffer.from(match[2], 'base64url');
  if (
    bytes.length < 32 ||
    bytes.length > 64 ||
    bytes.toString('base64url') !== match[2]
  )
    return false;
  // Browser hashes the UTF-8 encoded secret text, never the whole credentialId.secret token.
  const supplied = createHash('sha256').update(match[2], 'utf8').digest();
  return timingSafeEqual(supplied, Buffer.from(credential.verifier, 'hex'));
}
