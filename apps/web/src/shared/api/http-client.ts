import type { AuthUser, LoginResponse } from "@/shared/types/domain";
const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";

export const AUTH_STORAGE_KEY = "agritrace-auth";

type ApiEnvelope<T> = { success: true; data: T };

type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
};

let refreshPromise: Promise<string> | null = null;

function readAccessToken(): string | null {
  return readStoredAuth()?.accessToken ?? null;
}

function readStoredAuth(): StoredAuth | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(
      localStorage.getItem(AUTH_STORAGE_KEY) ?? "null",
    ) as StoredAuth | null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const stored = readStoredAuth();
    if (!stored?.refreshToken) throw new Error("Không có refresh token");
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    }).catch(() => {
      throw {
        status: 0,
        code: "NETWORK_ERROR",
        message: "Không thể làm mới phiên do mất kết nối. Vui lòng thử lại.",
      };
    });
    const envelope = (await response
      .json()
      .catch(() => null)) as ApiEnvelope<LoginResponse> | null;
    if (readStoredAuth()?.refreshToken !== stored.refreshToken)
      throw {
        status: 401,
        message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
      };
    if (!response.ok || !envelope?.success) {
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        window.dispatchEvent(new Event("auth-changed"));
      }
      throw {
        status: response.status,
        message:
          response.status >= 500
            ? "Máy chủ tạm thời không phản hồi. Vui lòng thử lại."
            : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      };
    }
    const next: StoredAuth = {
      accessToken: envelope.data.accessToken,
      refreshToken: envelope.data.refreshToken,
      refreshExpiresAt: envelope.data.refreshExpiresAt,
      user: envelope.data.user,
    };
    if (readStoredAuth()?.refreshToken !== stored.refreshToken)
      throw {
        status: 401,
        message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
      };
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    return next.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function revokeSession(): Promise<void> {
  const stored = readStoredAuth();
  if (!stored?.refreshToken) return;
  await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: stored.refreshToken }),
  }).catch(() => undefined);
}

export function isApiError(error: unknown): error is { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
  canRefresh = true,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const sessionUserId = authenticated ? readStoredAuth()?.user?.id : undefined;
  const token = authenticated ? readAccessToken() : null;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    if (!headers.has("idempotency-key"))
      headers.set("idempotency-key", crypto.randomUUID());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  }).catch(() => {
    throw {
      status: 0,
      code: "NETWORK_ERROR",
      message: "Không kết nối được máy chủ. Hãy thử lại khi có mạng.",
    };
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | {
        error?: { code?: string; message?: string | string[] };
        statusCode?: number;
        status?: number;
        code?: string;
        message?: string | string[];
      }
    | null;
  if (authenticated && readStoredAuth()?.user?.id !== sessionUserId)
    throw {
      status: 401,
      code: "SESSION_CHANGED",
      message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
    };
  if (response.status === 401 && authenticated && canRefresh) {
    if (readAccessToken() === token) await refreshAccessToken();
    return request<T>(path, { ...init, headers }, authenticated, false);
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      window.dispatchEvent(new Event("auth-changed"));
    }
    const detail =
      payload && "error" in payload && payload.error ? payload.error : payload;
    const rawMessage =
      detail && "message" in detail ? detail.message : undefined;
    const message = Array.isArray(rawMessage)
      ? rawMessage.join("; ")
      : rawMessage;
    throw {
      status: response.status,
      code:
        detail && "code" in detail
          ? (detail.code ?? "HTTP_ERROR")
          : "HTTP_ERROR",
      message:
        message ||
        (
          {
            401: "Email hoặc mật khẩu không đúng.",
            403: "Bạn không có quyền thực hiện thao tác này.",
            409: "Dữ liệu đã thay đổi hoặc thao tác đang được xử lý. Hãy tải lại dữ liệu và kiểm tra trước khi thử lại.",
            422: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
            503: "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.",
          } as Record<number, string>
        )[response.status] ||
        "Yêu cầu thất bại. Vui lòng thử lại.",
    };
  }
  if (payload && "success" in payload) return payload.data;
  return payload as T;
}
