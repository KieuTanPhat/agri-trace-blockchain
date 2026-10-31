import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { errorText } from "../api/client";
import { LatestRequest } from "./latest-request";

/** Load-on-mount with explicit reload; no background retry loop. */
export function useResource<T>(
  load: () => Promise<T>,
  scope: string,
  deps: readonly (string | number | boolean | null | undefined)[] = [],
) {
  const key = JSON.stringify([
    scope,
    ...deps.map((value) => [typeof value, value]),
  ]);
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>(() => ({ key, data: null, error: null, loading: true }));
  const loader = useRef(load);
  const committedKey = useRef(key);
  const requests = useRef(new LatestRequest());
  useEffect(() => {
    loader.current = load;
    committedKey.current = key;
  }, [load, key]);
  const fetchLatest = useCallback(async (requestKey: string) => {
    const request = requests.current.begin();
    const read = loader.current;
    // Promise callbacks run after commit; effect setup never synchronously sets state.
    await Promise.resolve()
      .then(read)
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
    setState((previous) => ({
      key: requestKey,
      data: previous.key === requestKey ? previous.data : null,
      error: null,
      loading: true,
    }));
    await fetchLatest(requestKey);
  }, [fetchLatest]);
  useEffect(() => {
    const active = requests.current;
    void fetchLatest(key);
    return () => active.cancel();
  }, [key, fetchLatest]);
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
  const visible =
    state.key === key ? state : { data: null, error: null, loading: true };
  return { ...visible, reload, setData };
}
