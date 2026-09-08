export type ContractErrorCode =
  | "DUPLICATE_BATCH"
  | "DUPLICATE_EVENT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHORIZED_RELAYER"
  | "UNSUPPORTED_EVENT_TYPE";

export function contractError(code: ContractErrorCode, message: string): Error {
  return new Error(`${code}: ${message}`);
}
