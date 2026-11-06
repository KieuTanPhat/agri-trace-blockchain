export const ROLE_CODES = [
  'SYSTEM_ADMIN',
  'FARM_STAFF',
  'IOT_DEVICE',
  'TRANSPORTER',
  'DISTRIBUTOR',
  'PROCESSOR',
  'RETAILER',
  'ENTERPRISE_STAFF',
  'AUDITOR',
  'SYSTEM_ACTOR',
] as const;

/** Business roles of the five enterprise organization types. */
export const BUSINESS_ROLES = [
  'FARM_STAFF',
  'TRANSPORTER',
  'DISTRIBUTOR',
  'PROCESSOR',
  'RETAILER',
] as const;
type BusinessRole = (typeof BUSINESS_ROLES)[number];

const BUSINESS_ROLE_BY_ORGANIZATION_TYPE: Record<string, BusinessRole> = {
  FARM: 'FARM_STAFF',
  TRANSPORTER: 'TRANSPORTER',
  DISTRIBUTOR: 'DISTRIBUTOR',
  PROCESSOR: 'PROCESSOR',
  RETAILER: 'RETAILER',
};

export const businessRoleForOrganization = (
  type: string | null | undefined,
): BusinessRole | null =>
  (type && BUSINESS_ROLE_BY_ORGANIZATION_TYPE[type]) || null;

type RoleSubject = {
  role: { code: string };
  organization?: { type: string } | null;
  enterpriseTier?: number | null;
};

/**
 * The role an account authorizes as. An enterprise employee (ENTERPRISE_STAFF)
 * takes the business role of its organization type, so only delegated members
 * (tier 2/3) of a business organization resolve; their detailed permissions
 * still come from the enterprise's EnterpriseRole grants. Returns null when the
 * account cannot act at all.
 */
export function effectiveRole(user: RoleSubject): string | null {
  if (user.role.code !== 'ENTERPRISE_STAFF') return user.role.code;
  if (!user.enterpriseTier || user.enterpriseTier < 2) return null;
  return businessRoleForOrganization(user.organization?.type);
}

/** Business role shown to clients: the owner's role or the employee's derived one. */
export function businessRoleOf(user: RoleSubject): BusinessRole | null {
  const role = effectiveRole(user);
  return (BUSINESS_ROLES as readonly string[]).includes(role ?? '')
    ? (role as BusinessRole)
    : null;
}
