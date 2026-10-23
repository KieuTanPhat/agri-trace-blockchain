"use client";
import { useMemo } from "react";
import {
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type UseInfiniteQueryOptions,
  type InfiniteData,
  type QueryKey,
  type UseQueryOptions,
  type QueryFilters,
} from "@tanstack/react-query";
import { useAuth } from "../auth-store";
import { getAuthorizationScope } from "../auth-scope";
export { useMutation, keepPreviousData } from "@tanstack/react-query";
export function useLedgerInfiniteQuery<
  TQueryFnData,
  TError = Error,
  TData = InfiniteData<TQueryFnData>,
  TQueryKey extends QueryKey = QueryKey,
  TPageParam = unknown,
>(
  options: UseInfiniteQueryOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryKey,
    TPageParam
  >,
) {
  const auth = useAuth();
  return useInfiniteQuery({
    ...options,
    queryKey: ["ledger", getAuthorizationScope(auth.user), ...options.queryKey],
    enabled:
      auth.user && auth.privateAccessStatus === "ready"
        ? (options.enabled ?? true)
        : false,
  } as UseInfiniteQueryOptions<
    TQueryFnData,
    TError,
    TData,
    QueryKey,
    TPageParam
  >);
}
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
