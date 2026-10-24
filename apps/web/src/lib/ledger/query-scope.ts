import { getAuthorizationScope } from "../auth-scope";

export function ledgerQueryKey(user: Parameters<typeof getAuthorizationScope>[0], suffix: readonly unknown[]): readonly unknown[] {
  return ["ledger", getAuthorizationScope(user), ...suffix];
}
