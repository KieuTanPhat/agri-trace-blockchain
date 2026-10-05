import { request } from "@/shared/api/http-client";
import type { Organization } from "@/shared/types/domain";

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
