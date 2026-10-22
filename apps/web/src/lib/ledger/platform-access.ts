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
  const can = useCallback(
    (permission: string) => {
      if (!auth.user || auth.privateAccessStatus !== "ready") return false;
      const role = auth.user.role.code;
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
  return { ...auth, can };
}
