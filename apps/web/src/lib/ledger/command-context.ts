import { getLedgerError } from "./errors";
export type LedgerCommandContext = { idempotencyKey: string; mfaCode?: string };
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
