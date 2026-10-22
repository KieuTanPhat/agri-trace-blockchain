import type { AuthUser, Role } from "../types";
import { canAccessManagementRoute, platformAdminHome } from "../permissions";
// Extracted baseline account/role policy only; no old navigation groups or renderer.
const nonEnterpriseRoles: Role[] = ["SYSTEM_ADMIN", "AUDITOR", "COMPLIANCE_REVIEWER", "IOT_DEVICE", "SYSTEM_ACTOR"];
export function ledgerIsEnterpriseUser(user?: Pick<AuthUser, "organizationId" | "role"> | null): boolean {
  return !!user?.organizationId && !nonEnterpriseRoles.includes(user.role.code);
}
export function ledgerHomeRoute(user: AuthUser): string {
  return platformAdminHome(user.role.code) ?? (ledgerIsEnterpriseUser(user) ? "/enterprise" : "/dashboard");
}
export function ledgerLoginDestination(user: AuthUser, next?: string): string {
  if (user.mustChangePassword) return "/account/password";
  const home = ledgerHomeRoute(user), candidate = next || "/dashboard";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return home;
  const url = new URL(candidate, "https://ledger.invalid");
  if (url.origin !== "https://ledger.invalid") return home;
  if ((url.pathname === "/dashboard" && (platformAdminHome(user.role.code) || user.role.code === "DISTRIBUTOR")) || !canAccessManagementRoute(url.pathname, user.role.code, user.productionAccess)) return home;
  return url.pathname + url.search + url.hash;
}
