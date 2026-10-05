import { request } from "@/shared/api/http-client";
import type { Dashboard } from "@/shared/types/domain";
import { USE_MOCK_API } from "@/shared/api/config";
import { mockDashboard } from "@/mocks/mock-api";

export async function getDashboard(): Promise<Dashboard> {
  if (USE_MOCK_API) return mockDashboard();
  return request("/dashboard");
}
