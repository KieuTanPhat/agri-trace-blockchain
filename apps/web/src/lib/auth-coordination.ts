export const AUTH_SYNC_KEY = "agritrace-auth-change";

type AuthChange = { id: string; state: "signed-in" | "signed-out" };
let fallbackChange: AuthChange | null = null;
let authQueue = Promise.resolve();

export function readAuthChange(): AuthChange | null {
  if (typeof window === "undefined") return fallbackChange;
  try {
    const raw = window.localStorage.getItem(AUTH_SYNC_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      typeof parsed.id === "string" &&
      "state" in parsed &&
      (parsed.state === "signed-in" || parsed.state === "signed-out")
    ) {
      return parsed as AuthChange;
    }
  } catch {
    // Session credentials never depend on optional browser storage.
  }
  return fallbackChange;
}

export function publishAuthChange(state: AuthChange["state"]): AuthChange {
  const change = { id: crypto.randomUUID(), state };
  fallbackChange = change;
  try {
    window.localStorage.setItem(AUTH_SYNC_KEY, JSON.stringify(change));
  } catch {
    // The current tab still invalidates its old requests and cached data.
  }
  return change;
}

/** Serialize cookie mutations within a tab and, on HTTPS, across tabs. */
export function withAuthLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = authQueue.then(async () => {
    if (typeof window !== "undefined" && window.navigator.locks) {
      return await window.navigator.locks.request("agritrace-auth", operation);
    }
    return await operation();
  });
  authQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
