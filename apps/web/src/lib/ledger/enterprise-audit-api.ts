import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
export type EnterpriseAuditEntry =
  components["schemas"]["EnterpriseAuditEntryDto"];
export type EnterpriseAuditFilters = {
  q?: string;
  employeeId?: string;
  action?: string;
  outcome?: string;
  from?: string;
  to?: string;
};
export function enterpriseAudit(
  filters: EnterpriseAuditFilters,
  cursor?: string,
) {
  const query = new URLSearchParams({ limit: "25" });
  for (const [key, value] of Object.entries({ ...filters, cursor }))
    if (value) query.set(key, value);
  return ledgerRequest<components["schemas"]["EnterpriseAuditPageDto"]>(
    "/enterprise-workspace/audit?" + query,
  );
}
