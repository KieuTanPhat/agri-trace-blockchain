export type EnterpriseAccess = {
  stage: string;
  owner: boolean;
  primary: boolean;
  tier?: number | null;
  permissions: string[];
  capabilities: string[];
};
export function canUseEnterpriseRoute(
  path: string,
  access: EnterpriseAccess,
): boolean {
  const within = (prefix: string) =>
    path === prefix || path.startsWith(prefix + "/");
  const active = ["ACTIVE", "ACTIVE_LEGACY"].includes(access.stage);
  if (within("/enterprise/service") || within("/enterprise/onboarding"))
    return access.owner;
  if (!active) return false;
  const permissions = access.permissions,
    has = (p: string) => permissions.includes(p);
  if (within("/enterprise/connections")) return access.owner;
  if (within("/enterprise/members/new")) return has("members.manage");
  if (within("/enterprise/members"))
    return has(
      path === "/enterprise/members" ? "members.read" : "members.manage",
    );
  if (within("/enterprise/roles"))
    return has(path === "/enterprise/roles" ? "members.read" : "roles.manage");
  if (within("/enterprise/partners/invite")) return has("partners.manage");
  if (within("/enterprise/partners")) return has("partners.read");
  if (within("/enterprise/products"))
    return has(path.endsWith("/new") || path.endsWith('/import') ? "catalog.manage" : "catalog.read");
  if (within("/enterprise/areas"))
    return (
      access.capabilities.includes("FARM") &&
      has(path.includes("/new") ? "catalog.manage" : "catalog.read")
    );
  if (within("/enterprise/sites"))
    return has(path.endsWith("/new") ? "sites.manage" : "sites.read");
  if (within("/enterprise/vehicles"))
    return (
      access.capabilities.includes("TRANSPORTER") &&
      has(path.endsWith("/new") ? "vehicles.manage" : "vehicles.read")
    );
  if (within("/enterprise/qr")) return has("qr.manage");
  if (within("/enterprise/inventory")) return has("inventory.manage") || has("quarantine.manage");
  if (within("/enterprise/materials")) return access.capabilities.includes('FARM') && has(path.endsWith('/new') ? 'materials.manage' : 'materials.read');
  if (within("/enterprise/inbox")) return has("profile.read");
  if (within("/enterprise/messages")) return has("profile.read");
  if (within("/enterprise/settings")) return has("profile.read");
  if (within("/enterprise/help")) return has("profile.read");
  if (within("/enterprise/ownership")) return has("profile.read");
  if (within("/enterprise/notices"))
    return access.capabilities.includes("FARM") && has("distribution.write");
  if (within("/enterprise/reports/adjust")) return has("quantity.adjust");
  if (within("/enterprise/reports")) return has("reports.read");
  if (within("/enterprise/signing")) return has("distribution.sign");
  if (path === "/enterprise") return has("profile.read");
  if (within("/enterprise/profile")) return has("profile.read");
  if (within("/distribution/new")) return has("distribution.write");
  if (within("/distribution")) return has("distribution.read");
  if (within("/production-cycles"))
    return (
      access.capabilities.includes("FARM") &&
      has(
        path.endsWith("/new") ||
          path.endsWith("/plant") ||
          path.endsWith("/journal/new") ||
          path.endsWith("/harvests/new")
          ? "production.write"
          : "production.read",
      )
    );
  if (within("/iot-simulator"))
    return access.capabilities.includes("FARM") && has("production.write");
  if (within("/lots") || within("/dashboard"))
    return (
      has("trace.read") || has("production.read") || has("distribution.read")
    );
  if (within("/supply-chains"))
    return (
      access.primary ||
      has("trace.read") ||
      has("production.read") ||
      has("distribution.read")
    );
  if (within("/compliance"))
    return access.capabilities.includes("FARM") && has("production.read");
  return true;
}
