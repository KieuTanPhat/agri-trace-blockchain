import { request, isApiError } from "@/shared/api/http-client";
import type { LotTrace } from "@/shared/types/domain";
import { USE_MOCK_API } from "@/shared/api/config";
import { mockLots } from "@/mocks/mock-api";

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
