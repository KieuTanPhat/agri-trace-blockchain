export const ROLE_CODES = [
  'SYSTEM_ADMIN',
  'PLATFORM_OPERATOR',
  'PLATFORM_CASE_MANAGER',
  'PLATFORM_PRIVACY_OFFICER',
  'FARM_STAFF',
  'IOT_DEVICE',
  'TRANSPORTER',
  'DISTRIBUTOR',
  'RETAILER',
  'AUDITOR',
  'COMPLIANCE_REVIEWER',
  'SYSTEM_ACTOR',
] as const;

export const PLATFORM_ADMIN_ROLES = [
  'SYSTEM_ADMIN',
  'PLATFORM_OPERATOR',
  'PLATFORM_CASE_MANAGER',
  'PLATFORM_PRIVACY_OFFICER',
] as const;
export const isPlatformAdminRole = (role: string) =>
  (PLATFORM_ADMIN_ROLES as readonly string[]).includes(role);
