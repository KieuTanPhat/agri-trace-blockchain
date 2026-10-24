"use client";
import { useLedgerQuery } from "./data";
import { useAuth } from "../auth-store";
import { wapi } from "./workspace-api";
import {ledgerIsEnterpriseUser} from "./session-navigation";
export function useOverview() {
  return useLedgerQuery({ queryKey: ["ws-overview"], queryFn: wapi.overview });
}
export function useWorkspaceAccess() {
  const auth = useAuth();
  const query = useLedgerQuery({ queryKey: ["enterprise-access"], queryFn: wapi.access, enabled:ledgerIsEnterpriseUser(auth.user) });
  const access = query.data;
  const active = !!access && ["ACTIVE", "OPERATOR_PROVISIONED"].includes(access.stage);
  return {
    access, primary: access?.primary ?? false, owner: access?.owner ?? false, tier: access?.tier ?? null,
    // Scoped cached permissions only keep the hidden tree stable during a
    // recheck. LedgerAuthRouteGate blocks interaction, and queries stay disabled.
    can: (permission: string) => active && !!access?.permissions.includes(permission),
    error: query.error, isLoading: query.isLoading,
  };
}
