"use client";
import { useMemo } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseQueryOptions,
  type QueryFilters,
} from "@tanstack/react-query";
import { useAuth } from "../auth-store";
import { getAuthorizationScope } from "../auth-scope";
export function useLedgerQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
  const auth = useAuth();
  return useQuery<TQueryFnData, TError, TData>({
    ...options,
    queryKey: ["ledger", getAuthorizationScope(auth.user), ...options.queryKey],
    enabled:
      auth.user && auth.privateAccessStatus === "ready"
        ? (options.enabled ?? true)
        : false,
  } as UseQueryOptions<TQueryFnData, TError, TData>);
}
export function useLedgerQueryClient() {
  const client = useQueryClient(),
    { user } = useAuth(),
    scope = getAuthorizationScope(user);
  return useMemo(
    () => ({
      invalidateQueries: (filters: QueryFilters = {}) =>
        client.invalidateQueries({
          ...filters,
          queryKey: ["ledger", scope, ...(filters.queryKey ?? [])],
        }),
    }),
    [client, scope],
  );
}
