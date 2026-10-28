import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../api/client';
import {useFocusEffect} from 'expo-router';

/** Mount is loaded by useLoad; refresh an existing screen when returning to it. */
export function useReloadOnFocus(reload:()=>Promise<void>){
  const visited=useRef(false);
  useFocusEffect(useCallback(()=>{if(visited.current)void reload();visited.current=true;},[reload]));
}

/** Load-on-mount with explicit reload; no background retry loop. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loader = useRef(load);
  loader.current = load;
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loader.current());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading, reload, setData };
}
