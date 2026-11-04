import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useSessionScope } from "../auth/session";
import { useResource, type ResourceCacheOptions } from "./use-resource";

/** Refresh on return; cached public reads can skip this while their data is fresh. */
export function useReloadOnFocus(reload: () => Promise<void>) {
  const visited = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (visited.current) void reload();
      visited.current = true;
    }, [reload]),
  );
}

export function useLoad<T>(
  load: () => Promise<T>,
  deps: readonly (string | number | boolean | null | undefined)[] = [],
  cacheOptions?: ResourceCacheOptions,
) {
  return useResource(load, useSessionScope(), deps, cacheOptions);
}
