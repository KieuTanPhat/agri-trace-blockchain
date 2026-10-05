import { request } from "@/shared/api/http-client";
import type { ProductionCycleOption } from "@/shared/types/domain";

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
