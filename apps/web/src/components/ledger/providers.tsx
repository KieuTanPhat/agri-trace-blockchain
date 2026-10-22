"use client";

import { useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { getLedgerError } from "@/lib/ledger/errors";
import { TooltipProvider } from "./ui/tooltip";
import { Toaster } from "./ui/sonner";
import { LocaleBoundary } from "./locale";
import { LedgerConfirmProvider } from "./confirm-provider";
import { LedgerAuthRouteGate } from "./auth-route-gate";

function ScopeQueryProvider({
  children,
  scope,
  identity,
}: {
  children: React.ReactNode;
  scope: string;
  identity: string;
}) {
  const client = useMemo(() => {
    void identity;
    return new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 15_000,
          refetchOnWindowFocus: false,
          retry: (count, error) => {
            const status = getLedgerError(error)?.status ?? 0;
            return !(status >= 400 && status < 500) && count < 1;
          },
        },
      },
    });
  }, [identity]);
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  useEffect(() => {
    const filter = {
      predicate: (query: { queryKey: readonly unknown[] }) =>
        query.queryKey[0] === "ledger" && query.queryKey[1] !== scope,
    };
    void client.cancelQueries(filter);
    client.removeQueries(filter);
  }, [client, scope]);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
function AuthorizationBoundary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Select the empty cache in the same render as the new identity.
  return (
    <ScopeQueryProvider
      identity={getAuthorizationScope(
        user && { ...user, accessRevision: undefined },
      )}
      scope={getAuthorizationScope(user)}
    >
      {children}
    </ScopeQueryProvider>
  );
}
export function LedgerProviders({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <AuthorizationBoundary>
        <TooltipProvider delayDuration={300}>
          <LedgerConfirmProvider>
            <LocaleBoundary>
              <LedgerAuthRouteGate>{children}</LedgerAuthRouteGate>
            </LocaleBoundary>
          </LedgerConfirmProvider>
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </AuthorizationBoundary>
    </AuthProvider>
  );
}
