import { mockDashboard, mockLots, mockSendSensorReading, mockSubmitCommand } from "./mock-api";
import type { AllowedCommand, Dashboard, LotTrace, SensorReadingRequest, SensorReadingResponse } from "./types";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080/api";
const USE_MOCK_API = process.env.NEXT_PUBLIC_MOCK_API !== "false";

export async function getDashboard(): Promise<Dashboard> {
  if (USE_MOCK_API) return mockDashboard();
  return request("/dashboard");
}

export async function getLots(): Promise<LotTrace[]> {
  if (USE_MOCK_API) return mockLots;
  return request("/lots");
}

export async function getLotById(lotId: string): Promise<LotTrace> {
  if (USE_MOCK_API) {
    return mockLots.find((lot) => lot.lotId === lotId) ?? mockLots[0];
  }
  return request(`/lots/${lotId}`);
}

export async function getPublicTrace(lotId: string): Promise<LotTrace | null> {
  if (USE_MOCK_API) {
    return mockLots.find((lot) => lot.lotId === lotId) ?? null;
  }
  return request(`/public/trace/${lotId}`);
}

export async function submitCommand(lotId: string, command: AllowedCommand): Promise<{ ok: boolean; lotId: string; command: string; message: string }> {
  if (USE_MOCK_API) return mockSubmitCommand(lotId, command);
  return request(`/lots/${lotId}/commands/${command}`, { method: "POST" });
}

export async function sendSensorReading(payload: SensorReadingRequest): Promise<SensorReadingResponse> {
  if (USE_MOCK_API) return mockSendSensorReading(payload);
  return request("/iot/readings", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

async function request(path: string, init?: RequestInit) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    },
    ...init
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({
      status: response.status,
      code: "HTTP_ERROR",
      message: response.statusText
    }));
    throw error;
  }

  return response.json();
}
