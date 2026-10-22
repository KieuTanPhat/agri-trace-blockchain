import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
export type Enrollment = S["EnterpriseEnrollmentViewDto"];
export type CapabilityRequest = S["CapabilityRequestViewDto"];
export type EnterpriseConnection = S["EnterpriseConnectionViewDto"];
export type Approval = Omit<S["PlatformApprovalDto"], "operation"> & {
  operation: S["ProposeApprovalDto"]["operation"];
};
/** Aggregate fields supplied by AdminInsightsService.organization at the pinned baseline. */
export type PlatformOrganization = {
  id: string;
  name: string;
  type: string;
  status: string;
  version: number;
  participationModel: string;
  createdAt: string;
  billing: { subscription: { status: string } | null };
};
function write<T>(
  path: string,
  payload: unknown,
  cmd: LedgerCommandContext,
  method = "POST",
) {
  return ledgerRequest<T>(path, {
    method,
    headers: {
      "Idempotency-Key": cmd.idempotencyKey,
      ...(cmd.mfaCode ? { "X-MFA-Code": cmd.mfaCode } : {}),
    },
    body: JSON.stringify(payload),
  });
}
export const api = {
  enterprises: {
    enrollments: () => ledgerRequest<Enrollment[]>("/enterprise-enrollments"),
    enrollment: (id: string) =>
      ledgerRequest<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}`,
      ),
    organization: async (id: string) =>
      (
        await ledgerRequest<{ record: PlatformOrganization }>(
          `/platform-admin/organizations/${encodeURIComponent(id)}`,
        )
      ).record,
    review: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    reviewCapability: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<CapabilityRequest>(
        `/capability-requests/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    reviewConnection: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<EnterpriseConnection>(
        `/enterprise-connections/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    activate: (
      id: string,
      input: S["ActivateEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}/activate`,
        input,
        cmd,
      ),
  },
  approvals: {
    get: (id: string) =>
      ledgerRequest<Approval>(`/platform-approvals/${encodeURIComponent(id)}`),
    decide: (
      id: string,
      input: S["DecideApprovalDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Approval>(
        `/platform-approvals/${encodeURIComponent(id)}/decision`,
        input,
        cmd,
      ),
    cancel: (
      id: string,
      input: S["CancelApprovalDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Approval>(
        `/platform-approvals/${encodeURIComponent(id)}/cancel`,
        input,
        cmd,
      ),
  },
};
