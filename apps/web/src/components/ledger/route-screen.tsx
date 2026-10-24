"use client";
import { createContext, useContext, useMemo } from "react";
import type {
  LedgerScreenProps,
  LedgerRouteInput,
} from "@/lib/ledger/route-input";
import { LedgerAppShell } from "./shell/app-shell";
import { LedgerSystemNotices } from "./system-notices";
const RouteContext = createContext<LedgerRouteInput | null>(null);
export function LedgerRouteScreen({
  route,
  name,
  children,
}: LedgerScreenProps & { name: string; children: React.ReactNode }) {
  return (
    <RouteContext.Provider value={route}>
      <LedgerAppShell>
        <LedgerSystemNotices />
        <div
          data-testid={`ledger-screen-${name}`}
          className="flex min-w-0 flex-1 flex-col"
        >
          {children}
        </div>
      </LedgerAppShell>
    </RouteContext.Provider>
  );
}
function useRoute() {
  const route = useContext(RouteContext);
  if (!route) throw new Error("Ledger route input is missing");
  return route;
}
export function useLedgerParams<T extends Record<string, string | string[]>>() {
  return useRoute().params as T;
}
export function useLedgerSearchParams() {
  const { searchParams } = useRoute();
  return useMemo(() => {
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (Array.isArray(value))
        for (const item of value) result.append(key, item);
      else if (value !== undefined) result.set(key, value);
    }
    return result;
  }, [searchParams]);
}
