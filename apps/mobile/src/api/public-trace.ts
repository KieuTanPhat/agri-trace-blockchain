import { isTraceToken } from "../trace/trace-input";
import type { components } from "./generated/api";

export type PublicLot = components["schemas"]["PublicLotDto"];

const DEFAULT_API_BASE_URL = "http://localhost:8080/api";

export function apiBaseUrl(value = process.env.EXPO_PUBLIC_API_BASE_URL): string {
  return (value?.trim() || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = { baseUrl?: string; fetchImpl?: typeof fetch; signal?: AbortSignal };

/** Public trace projection; no session or credentials. A missing lot resolves to null. */
export async function getPublicTrace(token: string, options: Options = {}): Promise<PublicLot | null> {
  if (!isTraceToken(token)) throw new ApiError(400, "Mã truy xuất không hợp lệ");
  const { baseUrl = apiBaseUrl(), fetchImpl = fetch, signal } = options;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/public/trace/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "Không kết nối được máy chủ AgriTrace. Kiểm tra mạng rồi thử lại.");
  }
  if (response.status === 404) return null;
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, errorMessage(body) ?? "Không tải được hành trình lô hàng");
  if (!isEnvelope(body)) throw new ApiError(response.status, "Phản hồi từ máy chủ không đúng định dạng");
  return body.data;
}

function isEnvelope(body: unknown): body is { success: true; data: PublicLot } {
  return (
    typeof body === "object" &&
    body !== null &&
    (body as { success?: unknown }).success === true &&
    typeof (body as { data?: { lotId?: unknown } }).data?.lotId === "string"
  );
}

function errorMessage(body: unknown): string | null {
  const message = (body as Partial<components["schemas"]["ApiErrorEnvelopeDto"]> | null)?.error?.message;
  if (typeof message === "string") return message;
  return Array.isArray(message) && message.every((part) => typeof part === "string") ? message.join("; ") : null;
}
