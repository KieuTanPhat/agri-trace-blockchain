import { request } from "../api-client";
import type { components } from "../generated/api";
import { getLedgerError } from "./errors";
export type LedgerCommandContext = { idempotencyKey: string; mfaCode?: string };
export type ApprovalOperation = components["schemas"]["ProposeApprovalDto"]["operation"];
export const newLedgerCommandKey = () => crypto.randomUUID();
export function ledgerCommandError(error: unknown) {
  const e = getLedgerError(error) ?? { status: 0, code: "UNKNOWN", message: "Chưa nhận được kết quả yêu cầu" };
  return { ...e, messages: [e.message], isConflict: e.status === 409, isStepUp: /MFA/.test(e.code) };
}
export function ledgerApprovalProposal(payload: components["schemas"]["ProposeApprovalDto"], command: LedgerCommandContext) {
  return request<components["schemas"]["PlatformApprovalDto"]>("/platform-approvals", { method: "POST", headers: { "Idempotency-Key": command.idempotencyKey, ...(command.mfaCode ? { "X-MFA-Code": command.mfaCode } : {}) }, body: JSON.stringify(payload) });
}
