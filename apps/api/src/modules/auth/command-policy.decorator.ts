import { SetMetadata } from '@nestjs/common';

export const COMMAND_POLICY_KEY = 'command-policy-authority';
export type BusinessCommandRole =
  'FARM_STAFF' | 'TRANSPORTER' | 'RETAILER' | 'COMPLIANCE_REVIEWER';
/** Only controllers whose commands always enter IdempotencyService with a
 * current-resource policy may use this. JWT/session checks stay mandatory;
 * a scoped role is checked before any result replay or domain commit. */
export const CommandPolicy = (...roles: BusinessCommandRole[]) =>
  SetMetadata(COMMAND_POLICY_KEY, roles);
