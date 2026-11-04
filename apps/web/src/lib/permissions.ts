import type { AuthUser, Role } from "./types";

/** Role used for business decisions: an enterprise employee (ENTERPRISE_STAFF)
 * acts as its organization type's business role; detailed permissions still
 * come from the enterprise access projection. */
export function actingRole(user: Pick<AuthUser, "role" | "businessRole">): Role {
  return user.businessRole ?? user.role.code;
}

export function platformAdminHome(role?: Role): string | null {
  return role === "SYSTEM_ADMIN" ? "/admin" : null;
}

export function canWriteFarm(role?: Role, productionAccess?: boolean): boolean {
  return productionAccess ?? role === "FARM_STAFF";
}

export function canAccessManagementRoute(
  path: string,
  role: Role,
  productionAccess?: boolean,
): boolean {
  const within = (prefix: string) =>
    path === prefix || path.startsWith(prefix + "/");
  // The retired simulator address has the same boundary as its redirect target.
  if (within("/iot-simulator")) path = "/enterprise/devices";
  // Every signed-in account may change its own password.
  if (path === "/account/password" || path === "/account/privacy") return true;
  // Every platform account has a notifications page behind the header bell.
  if (path === "/admin/notifications") return role === "SYSTEM_ADMIN";
  // Auditors may read the platform audit log and nothing else under /admin.
  if (
    role === "AUDITOR" &&
    (path === "/admin/audit-log" ||
      path === "/admin/operations" ||
      path === "/admin/recall" ||
      path === "/admin/cases" ||
      /^\/admin\/cases\/[0-9a-f-]{36}$/i.test(path) ||
      [
        "/admin/ledger",
        "/admin/statistics",
        "/admin/billing",
        "/admin/billing/subscriptions",
        "/admin/billing/invoices",
        "/admin/billing/revenue",
        "/admin/trace-report",
        "/admin/security-alerts",
      ].includes(path))
  )
    return true;
  if (role === "SYSTEM_ADMIN")
    return (
      path === "/admin" ||
      within("/admin/enterprises") ||
      path === "/admin/products" ||
      /^\/admin\/products\/(?:shared|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/i.test(
        path,
      ) ||
      within("/admin/organizations") ||
      within("/admin/users") ||
      within("/admin/audit-log") ||
      within("/admin/operations") ||
      within("/admin/recall") ||
      within("/admin/privacy") ||
      within("/admin/cases") ||
      within("/admin/security") ||
      within("/admin/compliance-assignments") ||
      within("/admin/inspectors") ||
      [
        "/admin/inbox",
        "/admin/notices",
        "/admin/news",
        "/admin/directory",
        "/admin/roles",
        "/admin/chains",
        "/admin/qr",
        "/admin/lots",
        "/admin/trace-report",
        "/admin/ledger",
        "/admin/billing",
        "/admin/reports",
        "/admin/support",
        "/admin/statistics",
        "/admin/monitoring",
        "/admin/security-alerts",
        "/admin/reference-data",
        "/admin/settings",
        "/admin/backup",
      ].some(within) ||
      within("/scan")
    );
  if (
    (within("/enterprise") || within("/distribution")) &&
    [
      "SYSTEM_ADMIN",
      "AUDITOR",
      "IOT_DEVICE",
      "SYSTEM_ACTOR",
    ].includes(role)
  )
    return false;
  if (
    role === "DISTRIBUTOR" &&
    !productionAccess &&
    (within("/production-cycles") || within("/lots") || within("/dashboard"))
  )
    return false;
  if (within("/admin")) return false;
  if (within("/production-cycles") && productionAccess) return true;
  if (within("/compliance"))
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
    ].includes(role);
  if (within("/production-cycles")) {
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
    ].includes(role);
  }
  return true;
}
