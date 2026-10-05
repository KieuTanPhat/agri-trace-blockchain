import { request } from "@/shared/api/http-client";
import type { LotTrace } from "@/shared/types/domain";
import { USE_MOCK_API } from "@/shared/api/config";
import { mockLots } from "@/mocks/mock-api";

export async function getLots(): Promise<LotTrace[]> {
  if (USE_MOCK_API) return mockLots;
  return request("/lots");
}

export async function getLotById(lotId: string): Promise<LotTrace> {
  if (USE_MOCK_API)
    return mockLots.find((lot) => lot.lotId === lotId) ?? mockLots[0];
  return request(`/lots/${lotId}`);
}
