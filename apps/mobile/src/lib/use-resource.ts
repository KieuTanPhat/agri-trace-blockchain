import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { errorText } from "../api/client";
import { LatestRequest } from "./latest-request";

export type ResourceCacheOptions = { key: string; staleTimeMs: number };

type CachedResource = { value: unknown; updatedAt: number };
const resourceCache = new Map<string, CachedResource>();
const resourceLoads = new Map<string, Promise<unknown>>();
const MAX_CACHED_RESOURCES = 40;

function readFreshResource(key: string, staleTimeMs: number) {
  const cached = resourceCache.get(key);
  if (!cached || Date.now() - cached.updatedAt >= staleTimeMs) return null;
  resourceCache.delete(key);
  resourceCache.set(key, cached);
  return cached;
}

function cacheResource(key: string, value: unknown) {
  resourceCache.delete(key);
  resourceCache.set(key, { value, updatedAt: Date.now() });
  while (resourceCache.size > MAX_CACHED_RESOURCES) {
    const oldest = resourceCache.keys().next().value;
    if (oldest === undefined) break;
    resourceCache.delete(oldest);
  }
}

function loadCachedResource<T>(key: string, load: () => Promise<T>) {
  const pending = resourceLoads.get(key);
  if (pending) return pending as Promise<T>;

  const request = Promise.resolve()
    .then(load)
    .then((value) => {
      cacheResource(key, value);
      return value;
    })
    .finally(() => {
      if (resourceLoads.get(key) === request) resourceLoads.delete(key);
    });
  resourceLoads.set(key, request);
  return request;
}

/** Load-on-mount with opt-in in-memory caching and explicit refresh. */
export function useResource<T>(
  load: () => Promise<T>,
  scope: string,
  deps: readonly (string | number | boolean | null | undefined)[] = [],
  cacheOptions?: ResourceCacheOptions,
) {
  const key = JSON.stringify([
    scope,
    cacheOptions?.key ?? null,
    ...deps.map((value) => [typeof value, value]),
  ]);
  // The cache entry covers the same inputs as the read itself.
  const cacheKey = cacheOptions ? key : null;
  const staleTimeMs = cacheOptions?.staleTimeMs ?? 0;
  const initialCached =
    cacheKey && staleTimeMs > 0
      ? readFreshResource(cacheKey, staleTimeMs)
      : null;
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>(() => ({
    key,
    data: initialCached ? (initialCached.value as T) : null,
    error: null,
    loading: !initialCached,
  }));
  const loader = useRef(load);
  const committedKey = useRef(key);
  const committedCache = useRef({ key: cacheKey, staleTimeMs });
  const requests = useRef(new LatestRequest());
  useEffect(() => {
    loader.current = load;
    committedKey.current = key;
    committedCache.current = { key: cacheKey, staleTimeMs };
  }, [load, key, cacheKey, staleTimeMs]);
  const fetchLatest = useCallback(async (
    requestKey: string,
    force: boolean,
    requestCacheKey: string | null,
    requestStaleTimeMs: number,
  ) => {
    const request = requests.current.begin();
    const cached =
      requestCacheKey && requestStaleTimeMs > 0
        ? readFreshResource(requestCacheKey, requestStaleTimeMs)
        : null;
    if (!force && cached) {
      if (requests.current.current(request))
        setState({
          key: requestKey,
          data: cached.value as T,
          error: null,
          loading: false,
        });
      return;
    }
    const read = loader.current;
    // Promise callbacks run after commit; effect setup never synchronously sets state.
    await Promise.resolve()
      .then(() =>
        requestCacheKey
          ? loadCachedResource(requestCacheKey, read)
          : read(),
      )
      .then(
        (data) => {
          if (requests.current.current(request))
            setState({ key: requestKey, data, error: null, loading: false });
        },
        (error) => {
          if (requests.current.current(request))
            setState({
              key: requestKey,
              data: null,
              error: errorText(error),
              loading: false,
            });
        },
      );
  }, []);
  const reload = useCallback(async () => {
    const requestKey = committedKey.current;
    const cache = committedCache.current;
    setState((previous) => ({
      key: requestKey,
      data: previous.key === requestKey ? previous.data : null,
      error: null,
      loading: true,
    }));
    await fetchLatest(requestKey, true, cache.key, cache.staleTimeMs);
  }, [fetchLatest]);
  const reloadIfStale = useCallback(async () => {
    const cache = committedCache.current;
    if (
      cache.key &&
      cache.staleTimeMs > 0 &&
      readFreshResource(cache.key, cache.staleTimeMs)
    )
      return;
    await reload();
  }, [reload]);
  useEffect(() => {
    const active = requests.current;
    void fetchLatest(key, false, cacheKey, staleTimeMs);
    return () => active.cancel();
  }, [key, cacheKey, staleTimeMs, fetchLatest]);
  const setData = useCallback(
    (value: SetStateAction<T | null>) => {
      if (committedKey.current !== key) return;
      setState((previous) => ({
        ...previous,
        key,
        data:
          typeof value === "function"
            ? (value as (previous: T | null) => T | null)(
                previous.key === key ? previous.data : null,
              )
            : value,
      }));
    },
    [key],
  );
  const freshForCurrentKey =
    cacheKey && staleTimeMs > 0
      ? readFreshResource(cacheKey, staleTimeMs)
      : null;
  const visible = state.key === key
    ? state
    : {
        data: freshForCurrentKey ? (freshForCurrentKey.value as T) : null,
        error: null,
        loading: !freshForCurrentKey,
      };
  // Never expose the internal state key: callers spread this object into props.
  return { data: visible.data, error: visible.error, loading: visible.loading, reload, reloadIfStale, setData };
}
