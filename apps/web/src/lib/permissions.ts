import type { Role } from "./types";

export const platformAdminLabels: Record<string, string> = {
  SYSTEM_ADMIN: "Quản trị toàn nền tảng",
  PLATFORM_OPERATOR: "Vận hành (chỉ đọc)",
  PLATFORM_CASE_MANAGER: "Điều phối sự cố",
  PLATFORM_PRIVACY_OFFICER: "Phụ trách dữ liệu cá nhân",
};
export function platformAdminHome(role?: Role): string | null {
  if (role === "SYSTEM_ADMIN") return "/admin";
  if (role === "PLATFORM_OPERATOR") return "/admin/operations";
  if (role === "PLATFORM_CASE_MANAGER") return "/admin/cases";
  if (role === "PLATFORM_PRIVACY_OFFICER") return "/admin/privacy";
  return null;
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
  // Every signed-in account may change its own password.
  if (path === "/account/password" || path === "/account/privacy") return true;
  if (role !== "SYSTEM_ADMIN" && platformAdminHome(role)) {
    if (path === "/admin/security") return true;
    if (role === "PLATFORM_OPERATOR")
      return path === "/admin/operations" || path === "/admin/recall";
    if (role === "PLATFORM_CASE_MANAGER")
      return within("/admin/cases") || path === "/admin/recall";
    if (role === "PLATFORM_PRIVACY_OFFICER") return path === "/admin/privacy";
    return false;
  }
  // Auditors may read the platform audit log and nothing else under /admin.
  if (
    role === "AUDITOR" &&
    (path === "/admin/audit-log" ||
      path === "/admin/operations" ||
      path === "/admin/recall" ||
      path === "/admin/cases" ||
      /^\/admin\/cases\/[0-9a-f-]{36}$/i.test(path))
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
      within("/admin/approvals") ||
      within("/admin/security") ||
      within("/admin/compliance-assignments") ||
      within("/admin/inspectors") ||
      within("/scan")
    );
  if (
    (within("/enterprise") || within("/distribution")) &&
    [
      "SYSTEM_ADMIN",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
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
  if (within("/iot-simulator")) return canWriteFarm(role, productionAccess);
  if (within("/compliance"))
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
    ].includes(role);
  if (within("/production-cycles")) {
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
    ].includes(role);
  }
  return true;
}
