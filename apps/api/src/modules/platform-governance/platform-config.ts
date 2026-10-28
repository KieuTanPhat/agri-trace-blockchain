/** Feature flags and limits for platform governance. Read per call so an
 * operator change (and tests) take effect without module re-initialization. */
import { PLATFORM_ADMIN_ROLES } from '../auth/role-codes.js';
export type MfaMode = 'OFF' | 'OPTIONAL' | 'REQUIRED';

function intFrom(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : fallback;
}

/** OPTIONAL (default): an administrator may enrol; once enrolled, MFA is
 * enforced at login and for step-up. This lets an operator bootstrap the first
 * administrators. REQUIRED: administrators without MFA cannot run high-risk
 * operations. OFF: MFA endpoints and checks are disabled. */
export function mfaMode(): MfaMode {
  const value = process.env.PLATFORM_MFA_MODE?.trim().toUpperCase();
  return value === 'OFF' || value === 'REQUIRED' ? value : 'OPTIONAL';
}

export const loginMaxAttempts = () =>
  intFrom('PLATFORM_LOGIN_MAX_ATTEMPTS', 5, 3, 20);
export const loginLockMinutes = () =>
  intFrom('PLATFORM_LOGIN_LOCK_MINUTES', 15, 1, 1440);

export const PLATFORM_ROLES = [
  ...PLATFORM_ADMIN_ROLES,
  'COMPLIANCE_REVIEWER',
] as const;
export const MIN_REASON_LENGTH = 10;

