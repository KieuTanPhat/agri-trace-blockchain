import {
  mockDashboard,
  mockLots,
  mockSendSensorReading,
  mockSubmitCommand,
} from "./mock-api";
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
const USE_MOCK_API = process.env.NEXT_PUBLIC_MOCK_API === "true";
export const AUTH_STORAGE_KEY = "agritrace-auth";

type ApiEnvelope<T> = { success: true; data: T };
type StoredAuth = {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
  user: AuthUser;
};
let refreshPromise: Promise<string> | null = null;

export async function login(
  email: string,
  password: string,
): Promise<LoginResponse> {
  return request(
    "/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    false,
  );
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
): Promise<unknown> {
  return request(`/production-cycles/${cycleId}/harvests`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitCommand(
  lot: LotTrace,
  command: AllowedCommand,
  input: CommandInput = {},
): Promise<{ message: string }> {
  if (USE_MOCK_API) return mockSubmitCommand(lot.lotId, command);

  if (command === "createShipment") {
    await request("/shipments", {
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
    method: "POST",
    body: JSON.stringify(body),
  });
  return { message: "Thao tác đã được ghi nhận thành công." };
}

export async function sendSensorReading(
  payload: SensorReadingRequest,
): Promise<SensorReadingResponse> {
  if (USE_MOCK_API) return mockSendSensorReading(payload);
  return request("/iot/readings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

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
    });
    const envelope = (await response.json().catch(() => null)) as
      | ApiEnvelope<LoginResponse>
      | null;
    if (!response.ok || !envelope?.success) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      throw new Error("Phiên đăng nhập đã hết hạn");
    }
    const next: StoredAuth = {
      accessToken: envelope.data.accessToken,
      refreshToken: envelope.data.refreshToken,
      refreshExpiresAt: envelope.data.refreshExpiresAt,
      user: envelope.data.user,
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

function isApiError(error: unknown): error is { status: number } {
  return typeof error === "object" && error !== null && "status" in error;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  authenticated = true,
  canRefresh = true,
): Promise<T> {
  const method = init.method?.toUpperCase() ?? "GET";
  const token = authenticated ? readAccessToken() : null;
  const headers = new Headers(init.headers);
  if (init.body) headers.set("content-type", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (!["GET", "HEAD", "OPTIONS"].includes(method))
    headers.set("idempotency-key", crypto.randomUUID());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    cache: "no-store",
    headers,
  });
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | {
        statusCode?: number;
        status?: number;
        code?: string;
        message?: string | string[];
      }
    | null;
  if (response.status === 401 && authenticated && canRefresh) {
    await refreshAccessToken();
    return request<T>(path, init, authenticated, false);
  }
  if (!response.ok) {
    const message =
      payload && "message" in payload
        ? Array.isArray(payload.message)
          ? payload.message.join("; ")
          : payload.message
        : response.statusText;
    throw {
      status: response.status,
      code:
        payload && "code" in payload
          ? (payload.code ?? "HTTP_ERROR")
          : "HTTP_ERROR",
      message: message || "Yêu cầu thất bại",
    };
  }
  if (payload && "success" in payload) return payload.data;
  return payload as T;
}
