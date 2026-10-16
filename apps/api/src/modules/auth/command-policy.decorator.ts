import { SetMetadata } from '@nestjs/common';

export const COMMAND_POLICY_KEY = 'command-policy-authority';
export type BusinessCommandRole =
  'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER' | 'COMPLIANCE_REVIEWER';
/** Only controllers whose commands always enter IdempotencyService with a
 * current-resource policy may use this. JWT/session checks stay mandatory;
 * a scoped role is checked before any result replay or domain commit. */
export const CommandPolicy = (...roles: BusinessCommandRole[]) =>
  SetMetadata(COMMAND_POLICY_KEY, roles);

export const COMMAND_RECOVERY_READ_KEY = 'command-policy-recovery-read';
/** Marks a read that only inspects the caller's own command under the same
 * current-resource policy (authorizeCommand) as the command it recovers. The
 * scoped-role candidate check is then allowed for this GET; it never grants a
 * write and the service still checks session, requester, cycle and scope. */
export const CommandRecoveryRead = () =>
  SetMetadata(COMMAND_RECOVERY_READ_KEY, true);
