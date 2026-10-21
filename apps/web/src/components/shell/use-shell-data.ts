"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";
import type { EnterpriseAccess } from "@/lib/enterprise-access";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";

/** Current enterprise access, discarded as soon as the authorization scope changes. */
export function useEnterpriseAccess({
  enabled,
  scope,
}: {
  enabled: boolean;
  scope: string;
}) {
  const [state, setState] = useState<{
    scope: string;
    data: EnterpriseAccess | null;
    error: boolean;
  }>({ scope: "", data: null, error: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener(PERMISSION_SYNC_EVENT, refresh);
    return () => window.removeEventListener(PERMISSION_SYNC_EVENT, refresh);
  }, []);
  useEffect(() => {
    let active = true;
    setState({ scope, data: null, error: false });
    if (!enabled) return;
    request<EnterpriseAccess>("/enterprise-access")
      .then((data) => {
        if (active) setState({ scope, data, error: false });
      })
      .catch(() => {
        if (active) setState({ scope, data: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, scope, revision]);
  return {
    access: state.scope === scope ? state.data : null,
    error: state.scope === scope && state.error,
    revision,
    retry: () => setRevision((n) => n + 1),
  };
}

/** In-app reminder: count of work waiting on this account (server-scoped). */
export function usePendingTaskCount({
  enabled,
  scope,
  pathname,
  revision,
}: {
  enabled: boolean;
  scope: string;
  pathname: string;
  revision: number;
}) {
  const [count, setCount] = useState<{ scope: string; total: number }>({
    scope: "",
    total: 0,
  });
  useEffect(() => {
    let active = true;
    if (!enabled) return;
    request<{ counts: { total?: number } }>("/distribution/tasks")
      .then((data) => {
        if (active) setCount({ scope, total: data.counts.total ?? 0 });
      })
      .catch(() => {
        if (active) setCount({ scope, total: 0 });
      });
    return () => {
      active = false;
    };
  }, [enabled, scope, pathname, revision]);
  return count.scope === scope ? count.total : 0;
}
