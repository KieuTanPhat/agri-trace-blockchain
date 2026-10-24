import { request } from "../api-client";
import type { components } from "../generated/api";
import { getLedgerError } from "./errors";
export type LedgerCommandContext = { idempotencyKey: string; mfaCode?: string };
export type ApprovalOperation =
  components["schemas"]["ProposeApprovalDto"]["operation"];
export const newLedgerCommandKey = () => crypto.randomUUID();
export function ledgerCommandError(error: unknown) {
  const e = getLedgerError(error) ?? {
    status: 0,
    code: "UNKNOWN",
    message: "Chưa nhận được kết quả yêu cầu",
  };
  const detail = error && typeof error === "object" ? error : {};
  return {
    ...e,
    messages: [e.message],
    isConflict: e.status === 409,
    isStepUp: /MFA|STEP_UP/.test(e.code),
    recoveryId:
      "recoveryId" in detail && typeof detail.recoveryId === "string"
        ? detail.recoveryId
        : undefined,
    canRestart: "canRestart" in detail && detail.canRestart === true,
  };
}
export function ledgerApprovalProposal(
  payload: components["schemas"]["ProposeApprovalDto"],
  command: LedgerCommandContext,
) {
  return request<components["schemas"]["PlatformApprovalDto"]>(
    "/platform-approvals",
    {
      method: "POST",
      headers: {
        "Idempotency-Key": command.idempotencyKey,
        ...(command.mfaCode ? { "X-MFA-Code": command.mfaCode } : {}),
      },
      body: JSON.stringify(payload),
    },
  );
}
