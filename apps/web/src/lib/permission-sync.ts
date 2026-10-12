export const PERMISSION_SYNC_KEY = "agritrace-permission-change:v1";
export const PERMISSION_SYNC_EVENT = "business-permissions-changed";
export const PERMISSION_CHECK_EVENT = "business-permissions-check";
let revision: string | undefined;
let accessEpoch = 0;
export function businessAccessEpoch() {
  return accessEpoch;
}
export function acceptBusinessAccessRevision(next: string) {
  if (next !== revision) {
    revision = next;
    accessEpoch += 1;
  }
}
export function invalidateBusinessAccess() {
  accessEpoch += 1;
}

/** Notify tabs to recheck the server. Store no grants, identities or tokens. */
export function publishPermissionChange() {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PERMISSION_SYNC_KEY, crypto.randomUUID());
  } catch {
    /* Focus and polling still revalidate when storage is unavailable. */
  }
  window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT));
}
