export type ContractErrorCode =
  | "DUPLICATE_EVENT"
  | "DUPLICATE_EVENT_CONFLICT"
  | "HASH_CHAIN_CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "UNAUTHORIZED_RELAYER";

export function contractError(code: ContractErrorCode, message: string): Error {
  return new Error(`${code}: ${message}`);
}
