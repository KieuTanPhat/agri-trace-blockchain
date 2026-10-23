"use client";
import { useLedgerQuery } from "./data";
import { useAuth } from "../auth-store";
import { wapi } from "./workspace-api";
export function useOverview() {
  return useLedgerQuery({ queryKey: ["ws-overview"], queryFn: wapi.overview });
}
export function useWorkspaceAccess() {
  const auth = useAuth();
  const query = useLedgerQuery({ queryKey: ["enterprise-access"], queryFn: wapi.access });
  const access = query.data;
  const active = !!access && ["ACTIVE", "ACTIVE_LEGACY"].includes(access.stage);
  return {
    access, primary: access?.primary ?? false, owner: access?.owner ?? false, tier: access?.tier ?? null,
    can: (permission: string) => auth.privateAccessStatus === "ready" && active && !!access?.permissions.includes(permission),
    error: query.error, isLoading: query.isLoading,
  };
}
