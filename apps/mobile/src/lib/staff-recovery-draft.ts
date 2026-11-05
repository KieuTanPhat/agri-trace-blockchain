/** Short-lived navigation state only. No OTP/password and no disk persistence. */
export type StaffRecoveryDraft = {
  attempt: { requestId: string; email: string };
  retryAt: number;
  expiresAt: number;
  acknowledged: boolean;
  message?: string;
};
const drafts = new Map<string, StaffRecoveryDraft>();
export function staffRecoveryDraft(email: string) {
  const key = email.trim().toLowerCase();
  const saved = drafts.get(key);
  if (saved && saved.expiresAt <= Date.now()) {
    drafts.delete(key);
    return undefined;
  }
  return saved;
}
export function rememberStaffRecovery(draft: StaffRecoveryDraft) {
  const key = draft.attempt.email.trim().toLowerCase();
  drafts.set(key, draft);
  if (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
}
export function discardStaffRecovery(email: string) {
  drafts.delete(email.trim().toLowerCase());
}
