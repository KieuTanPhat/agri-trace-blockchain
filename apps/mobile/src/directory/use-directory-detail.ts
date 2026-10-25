import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { apiBaseUrl } from "../config";
import { createDirectoryClient } from "../api/directory";
import {
  mergeDirectoryDetail,
  type DirectoryDetail,
  type DetailSection,
} from "./pagination";

export function useDirectoryDetail(
  kind: "products" | "enterprises",
  id: string,
) {
  const [data, setData] = useState<DirectoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const current = useRef<DirectoryDetail | null>(null);
  const epoch = useRef(0);
  const pending = useRef(false);
  const failed = useRef<{ section?: DetailSection; cursor?: string }>({});
  const controllers = useRef(new Set<AbortController>());
  const load = useCallback(
    async (generation: number, section?: DetailSection, cursor?: string) => {
      if (pending.current) return;
      pending.current = true;
      setLoading(true);
      setError("");
      failed.current = { section, cursor };
      const abort = new AbortController();
      controllers.current.add(abort);
      try {
        const client = createDirectoryClient(
          apiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL, __DEV__),
        );
        const result =
          kind === "products"
            ? await client.product(
                id,
                {
                  limit: 20,
                  enterpriseCursor:
                    section === "enterprises" ? cursor : undefined,
                  lotCursor: section === "lots" ? cursor : undefined,
                },
                abort.signal,
              )
            : await client.enterprise(
                id,
                {
                  limit: 20,
                  productCursor: section === "products" ? cursor : undefined,
                  certificateCursor:
                    section === "certificates" ? cursor : undefined,
                },
                abort.signal,
              );
        if (epoch.current !== generation) return;
        const next =
          section && current.current
            ? mergeDirectoryDetail(current.current, result, section)
            : result;
        current.current = next;
        setData(next);
      } catch (cause) {
        if (epoch.current === generation)
          setError(
            cause instanceof Error ? cause.message : "Chưa lấy được thông tin.",
          );
      } finally {
        controllers.current.delete(abort);
        if (epoch.current === generation) {
          pending.current = false;
          setLoading(false);
        }
      }
    },
    [kind, id],
  );
  useFocusEffect(
    useCallback(() => {
      const generation = ++epoch.current;
      pending.current = false;
      current.current = null;
      setData(null);
      void load(generation);
      const active = controllers.current;
      return () => {
        ++epoch.current;
        for (const abort of active) abort.abort();
        active.clear();
        pending.current = false;
      };
    }, [load, revision]),
  );
  return {
    data,
    loading,
    error,
    more: (section: DetailSection, cursor: string | null) => {
      if (cursor) void load(epoch.current, section, cursor);
    },
    retry: () =>
      void load(epoch.current, failed.current.section, failed.current.cursor),
    refresh: () => setRevision((value) => value + 1),
  };
}
