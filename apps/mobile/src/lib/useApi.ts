import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";
import { useSessionScope } from "../auth/session";
import { useResource } from "./use-resource";

/** Mount is loaded by useLoad; refresh an existing screen when returning to it. */
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
) {
  return useResource(load, useSessionScope(), deps);
}
