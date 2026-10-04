import { useEffect, useState } from "react";
import { request } from "./api-client";
export const apiBase =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
export function useRemote<T>(
  path: string | null,
  revision = 0,
  authenticated = true,
) {
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    let active = true;
    if (!path) {
      setState({ loading: false });
      return;
    }
    setState({ loading: true });
    request<T>(path, {}, authenticated)
      .then((data) => {
        if (active) setState({ data, loading: false });
      })
      .catch((e) => {
        if (active)
          setState({
            error: e.message ?? "Không tải được dữ liệu",
            loading: false,
          });
      });
    return () => {
      active = false;
    };
  }, [path, revision, authenticated]);
  return state;
}
export function queryString(values: Record<string, string | number>) {
  return new URLSearchParams(
    Object.entries(values)
      .filter(([, v]) => v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
}
export function csvCell(value: unknown) {
  const text = String(value ?? "");
  return (
    '"' +
    (/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""') +
    '"'
  );
}
export function downloadCsv(rows: unknown[][], name: string) {
  const url = URL.createObjectURL(
    new Blob(
      ["\ufeff" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n")],
      { type: "text/csv;charset=utf-8" },
    ),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
