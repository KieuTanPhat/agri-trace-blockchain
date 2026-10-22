/** Presentation adapter for the baseline client's plain error objects. */
export function getLedgerError(error: unknown): { status: number; message: string; code: string; requestId?: string } | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  return {
    status: "status" in error && typeof error.status === "number" ? error.status : 0,
    message: typeof error.message === "string" ? error.message : "Không thực hiện được yêu cầu",
    code: "code" in error && typeof error.code === "string" ? error.code : "UNKNOWN",
    requestId: "requestId" in error && typeof error.requestId === "string" ? error.requestId : undefined,
  };
}
