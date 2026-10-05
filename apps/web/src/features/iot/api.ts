import { request } from "@/shared/api/http-client";
import type {
  SensorReadingRequest,
  SensorReadingResponse,
} from "@/shared/types/domain";
import { USE_MOCK_API } from "@/shared/api/config";
import { mockSendSensorReading } from "@/mocks/mock-api";

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
