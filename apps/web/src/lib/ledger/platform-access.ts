"use client";
import { useCallback } from "react";
import { useAuth } from "../auth-store";
import { canAccessManagementRoute } from "../permissions";
const reads: Record<string, string> = {
  "dashboard.read": "/admin",
  "inbox.read": "/admin/inbox",
  "enrollment.read": "/admin/enterprises",
  "directory.read": "/admin/organizations",
  "approval.read": "/admin/approvals",
  "amendment.read": "/admin/enterprises/amendments",
  "users.read": "/admin/users",
  "audit.read": "/admin/audit-log",
  "security.read": "/admin/security",
  "statistics.read": "/admin/statistics",
  "assignment.read": "/admin/compliance-assignments",
  "inspectors.read": "/admin/inspectors",
  "roles.read": "/admin/roles",
  "privacy.read": "/admin/privacy",
  "reports.read": "/admin/reports",
  "recall.read": "/admin/recall",
  "notices.read": "/admin/notices",
  "operations.read": "/admin/operations",
  "ledger.read": "/admin/ledger",
  "traceReport.read": "/admin/trace-report",
  "chains.read": "/admin/chains",
  "lots.read": "/admin/lots",
  "products.read": "/admin/products",
  "qr.read": "/admin/qr",
  "reference.read": "/admin/reference-data",
  "billing.read": "/admin/billing",
  "monitoring.read": "/admin/monitoring",
  "backup.read": "/admin/backup",
  "securityAlerts.read": "/admin/security-alerts",
  "tickets.read": "/admin/support",
  "cases.read": "/admin/cases",
  "settings.read": "/admin/settings",
};
const administrator = new Set([
  "capability.review",
  "enrollment.review",
  "approval.propose",
  "approval.cancel",
  "approval.decide",
  "amendment.review",
  "operations.adminSummary",
  "organization.update",
  "billing.write",
]);
/** The preview supplies presentation names; baseline role/route policy supplies authority. */
export function useLedgerSession() {
  const auth = useAuth();
  const canRoute = useCallback(
    (href: string) => {
      if (
        !auth.user ||
        auth.privateAccessStatus !== "ready" ||
        !href.startsWith("/admin") ||
        href.startsWith("//")
      )
        return false;
      return canAccessManagementRoute(
        href.split(/[?#]/)[0],
        auth.user.role.code,
        auth.user.productionAccess,
      );
    },
    [auth.user, auth.privateAccessStatus],
  );
  const can = useCallback(
    (permission: string) => {
      if (!auth.user || auth.privateAccessStatus !== "ready") return false;
      const role = auth.user.role.code;
      if (permission === "privacy.write")
        return role === "SYSTEM_ADMIN" || role === "PLATFORM_PRIVACY_OFFICER";
      if (permission === "reports.triage")
        return role === "SYSTEM_ADMIN" || role === "PLATFORM_CASE_MANAGER";
      if (permission === "notices.write") return role === "SYSTEM_ADMIN";
      if (permission === "reference.write" || permission === "qr.write")
        return role === "SYSTEM_ADMIN";
      if (permission === "tickets.write")
        return role === "SYSTEM_ADMIN" || role === "PLATFORM_CASE_MANAGER";
      if (permission === "cases.write")
        return role === "SYSTEM_ADMIN" || role === "PLATFORM_CASE_MANAGER";
      if (reads[permission])
        return canAccessManagementRoute(
          reads[permission],
          role,
          auth.user.productionAccess,
        );
      return administrator.has(permission) && role === "SYSTEM_ADMIN";
    },
    [auth.user, auth.privateAccessStatus],
  );
  return { ...auth, can, canRoute };
}
