import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { mergeDirectoryItems, type Page } from "../api/directory";

/** Public, network-only pages. A new focus/filter invalidates old requests. */
export function usePublicPage<T extends { id: string }>(
  load: (cursor: string | undefined, signal: AbortSignal) => Promise<Page<T>>,
) {
  const [items, setItems] = useState<T[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const epoch = useRef(0);
  const pending = useRef(false);
  const failedCursor = useRef<string | undefined>(undefined);
  const controllers = useRef(new Set<AbortController>());
  const request = useCallback(
    async (next: string | undefined, generation: number) => {
      if (pending.current) return;
      pending.current = true;
      const abort = new AbortController();
      controllers.current.add(abort);
      setLoading(true);
      setError("");
      failedCursor.current = next;
      try {
        const page = await load(next, abort.signal);
        if (epoch.current !== generation) return;
        if (next && page.hasMore && page.nextCursor === next)
          throw new Error("Danh sách chưa cập nhật được trang tiếp theo.");
        setItems((previous) =>
          next ? mergeDirectoryItems(previous ?? [], page.items) : page.items,
        );
        setCursor(page.nextCursor);
      } catch (cause) {
        if (epoch.current === generation)
          setError(
            cause instanceof Error ? cause.message : "Chưa lấy được danh sách.",
          );
      } finally {
        controllers.current.delete(abort);
        if (epoch.current === generation) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [load],
  );
  useFocusEffect(
    useCallback(() => {
      const generation = ++epoch.current;
      pending.current = false;
      setItems(null);
      setCursor(null);
      void request(undefined, generation);
      const active = controllers.current;
      return () => {
        ++epoch.current;
        for (const abort of active) abort.abort();
        active.clear();
        pending.current = false;
      };
    }, [request, revision]),
  );
  return {
    items,
    loading,
    error,
    hasMore: cursor !== null,
    loadMore: () => {
      if (cursor) void request(cursor, epoch.current);
    },
    retry: () => void request(failedCursor.current, epoch.current),
    refresh: () => setRevision((value) => value + 1),
  };
}
