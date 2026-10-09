import {
  mockDashboard,
  mockLots,
  mockSendSensorReading,
  mockSubmitCommand,
} from "./mock-api";
import { getAuthorizationScope } from "./auth-scope";
import type {
  AllowedCommand,
  AuthUser,
  CommandInput,
  Dashboard,
  LoginResponse,
  LotTrace,
  Organization,
  ProductionCycleOption,
  SensorReadingRequest,
  SensorReadingResponse,
} from "./types";

const PUBLIC_API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
const API_BASE_URL =
  typeof window === "undefined"
    ? (process.env.API_INTERNAL_BASE_URL ?? PUBLIC_API_BASE_URL)
    : PUBLIC_API_BASE_URL;
const USE_MOCK_API = process.env.NEXT_PUBLIC_MOCK_API === "true";
export const AUTH_STORAGE_KEY = "agritrace-auth"; // Legacy key, removed on startup.

type ApiEnvelope<T> = { success: true; data: T };
let session: LoginResponse | null = null;
let sessionVersion = 0;
let identityVersion = 0;
let refreshPromise: Promise<string> | null = null;

export function readSession(): LoginResponse | null {
  return session;
}

export function setSession(next: LoginResponse, newIdentity = true): void {
  const changedAccount =
    session?.user.id !== next.user.id ||
    session?.user.organizationId !== next.user.organizationId ||
    session?.user.role.code !== next.user.role.code;
  session = next;
  sessionVersion++;
  if (newIdentity || changedAccount) identityVersion++;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("auth-changed"));
}

export function clearSession(): void {
  session = null;
  sessionVersion++;
  identityVersion++;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("auth-changed"));
}

export async function restoreSession(): Promise<LoginResponse> {
  await refreshAccessToken();
  if (!session) throw new Error("Không khôi phục được phiên đăng nhập");
  return session;
}

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  const result = await request<LoginResponse>(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false,
  );
  setSession(result);
  return result;
}

export async function getProfile(): Promise<AuthUser> {
  return request("/auth/me");
}

export async function getDashboard(): Promise<Dashboard> {
  if (USE_MOCK_API) return mockDashboard();
  return request("/dashboard");
}

export async function getLots(): Promise<LotTrace[]> {
  if (USE_MOCK_API) return mockLots;
  return request("/lots");
}

export async function getLotById(lotId: string): Promise<LotTrace> {
  if (USE_MOCK_API)
    return mockLots.find((lot) => lot.lotId === lotId) ?? mockLots[0];
  return request(`/lots/${lotId}`);
}

export async function getPublicTrace(
  traceToken: string,
): Promise<LotTrace | null> {
  if (USE_MOCK_API) {
    return (
      mockLots.find(
        (lot) =>
          lot.traceToken === traceToken ||
          lot.lotId === traceToken ||
          lot.lotCode === traceToken,
      ) ?? null
    );
  }
  try {
    return await request(
      `/public/trace/${encodeURIComponent(traceToken)}`,
      undefined,
      false,
    );
  } catch (error) {
    if (isApiError(error) && error.status === 404) return null;
    throw error;
  }
}

export async function getOrganizations(): Promise<Organization[]> {
  const organizations =
    await request<
      Array<{ id: string; name: string; type: Organization["type"] }>
    >("/organizations");
  return organizations.map(({ id, ...organization }) => ({
    organizationId: id,
    ...organization,
  }));
}

export function getProductionCycles(): Promise<ProductionCycleOption[]> {
  return request("/production-cycles");
}

export function recordHarvest(
  cycleId: string,
  input: {
    harvestTime: string;
    quantity: number;
    unit: string;
    grade?: string;
    qualityNote?: string;
    lotCode?: string;
  },
  idempotencyKey = crypto.randomUUID(),
): Promise<{
  lot: { id: string; lotCode: string };
  traceQr: { traceToken: string };
}> {
  return request(`/production-cycles/${cycleId}/harvests`, {
    headers: { "idempotency-key": idempotencyKey },
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitCommand(
  lot: LotTrace,
  command: AllowedCommand,
  input: CommandInput = {},
  idempotencyKey = crypto.randomUUID(),
): Promise<{ message: string }> {
  if (USE_MOCK_API) return mockSubmitCommand(lot.lotId, command);

  if (command === "createShipment") {
    await request("/shipments", {
      headers: { "idempotency-key": idempotencyKey },
      method: "POST",
      body: JSON.stringify({
        lotId: lot.lotId,
        transporterOrgId: input.transporterOrgId,
        retailerOrgId: input.retailerOrgId,
        origin: input.origin,
        destination: input.destination,
      }),
    });
    return { message: "Đã tạo chuyến vận chuyển." };
  }

  if (!lot.shipment)
    throw {
      status: 409,
      code: "SHIPMENT_REQUIRED",
      message: "Lô chưa có chuyến vận chuyển phù hợp.",
    };
  const base = { version: lot.shipment.version, lotVersion: lot.version ?? 0 };
  const endpoint: Record<Exclude<AllowedCommand, "createShipment">, string> = {
    startTransport: "start",
    reportArrival: "arrive",
    receiveRetail: "receive",
    rejectRetail: "reject",
    reportDamage: "damage",
  };
  const body =
    command === "receiveRetail"
      ? {
          ...base,
          receivedQuantity: input.receivedQuantity,
          damagedQuantity: input.damagedQuantity ?? 0,
          note: input.note,
        }
      : command === "rejectRetail"
        ? { ...base, reason: input.reason }
        : command === "reportDamage"
          ? { ...base, quantity: input.quantity, reason: input.reason }
          : base;
  await request(`/shipments/${lot.shipment.shipmentId}/${endpoint[command]}`, {
    headers: { "idempotency-key": idempotencyKey },
    method: "POST",
    body: JSON.stringify(body),
  });
  return { message: "Thao tác đã được ghi nhận thành công." };
}

export async function sendSensorReading(
  payload: SensorReadingRequest,
  idempotencyKey = crypto.randomUUID(),
): Promise<SensorReadingResponse> {
  if (USE_MOCK_API) return mockSendSensorReading(payload);
  return request("/iot/readings", {
    headers: { "idempotency-key": idempotencyKey },
    method: "POST",
    body: JSON.stringify(payload),
  });
}

function readAccessToken(): string | null {
  return session?.accessToken ?? null;
}

async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const startedAt = sessionVersion;
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      cache: "no-store",
      credentials: "include",
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
    if (sessionVersion !== startedAt)
      throw {
        status: 401,
        code: "SESSION_CHANGED",
        message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
      };
    if (!response.ok || !envelope?.success) {
      if (response.status === 401 || response.status === 403) {
        clearSession();
      }
      throw {
        status: response.status,
        message:
          response.status >= 500
            ? "Máy chủ tạm thời không phản hồi. Vui lòng thử lại."
            : "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
      };
    }
    setSession(envelope.data, false);
    return envelope.data.accessToken;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function revokeSession(): Promise<void> {
  // A refresh response can set a new cookie even after the UI has logged out.
  // Wait for that response, then revoke whichever cookie the browser holds.
  await refreshPromise?.catch(() => undefined);
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: "POST",
    keepalive: true,
    credentials: "include",
  });
  if (!response.ok) throw new Error("Không thể đăng xuất. Vui lòng thử lại.");
}

function isApiError(error: unknown): error is { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
  canRefresh = true,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const token = authenticated
    ? (readAccessToken() ?? (await refreshAccessToken()))
    : null;
  const requestIdentity = identityVersion;
  const requestScope = authenticated ? getAuthorizationScope(session?.user) : null;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    if (!headers.has("idempotency-key"))
      headers.set("idempotency-key", crypto.randomUUID());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    credentials: "include",
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
  if (authenticated && (identityVersion !== requestIdentity || getAuthorizationScope(session?.user) !== requestScope))
    throw {
      status: 401,
      code: "SESSION_CHANGED",
      message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
    };
  if (response.status === 401 && authenticated && canRefresh) {
    if (readAccessToken() === token) await refreshAccessToken();
    if (identityVersion !== requestIdentity || getAuthorizationScope(session?.user) !== requestScope) {
      throw {
        status: 401,
        code: "SESSION_CHANGED",
        message: "Phiên đăng nhập đã thay đổi. Vui lòng thử lại.",
      };
    }
    return request<T>(path, { ...init, headers }, authenticated, false);
  }
  if (!response.ok) {
    if (response.status === 401 && authenticated) {
      clearSession();
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
