import { useEffect, useRef, useState } from 'react';
import { errorText } from '../api/client';

/** One submission per mounted form, including taps before React paints busy. */
export function useSubmission() {
  const locked = useRef(false);
  const mounted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const run = async (task: (isCurrent: () => boolean) => Promise<void>) => {
    if (locked.current || !mounted.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    try {
      await task(() => mounted.current);
      // Keep locked after sent/queued: only the queue may reconcile that command.
    } catch (cause) {
      locked.current = false;
      if (mounted.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  return { run, busy, error };
}
