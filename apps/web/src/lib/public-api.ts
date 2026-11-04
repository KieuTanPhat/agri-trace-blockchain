import { request } from "@/lib/api-client";

/** Public reads use the shared API client so envelopes and origins stay consistent. */
export function publicRequest<T>(path: string): Promise<T> {
  return request<T>(path, undefined, false);
}

/** Direct image elements need the same API origin used by the request client. */
export function publicApiAssetUrl(path: string): string {
  const base =
    process.env.NEXT_PUBLIC_API_SAME_ORIGIN === "true" ||
    !!process.env.NEXT_PUBLIC_BUSINESS_ORIGIN
      ? "/api"
      : (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api");
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}
