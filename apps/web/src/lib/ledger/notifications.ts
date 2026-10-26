"use client";
import { useLedgerQuery } from "./data";
import { ledgerRequest } from "./request";
import { wapi } from "./enterprise-coordination-api";
import { api } from "./platform-api";

export type SystemNotice = {
  id: string;
  title: string;
  body: string;
  severity: string;
  endsAt: string;
};
const POLL = 60_000;

/** One feed for the header bell and the notifications page. Query keys match
 * the source pages so reading a message or deciding an item updates the bell. */
export function useNotificationFeed(
  scope:
    | { kind: "enterprise"; permissions: string[] }
    | { kind: "platform"; inbox: boolean },
) {
  const enterprise = scope.kind === "enterprise";
  const has = (p: string) => enterprise && scope.permissions.includes(p);
  const messages = useLedgerQuery({
    queryKey: ["ws-messages"],
    queryFn: wapi.messages,
    enabled: has("profile.read"),
    refetchInterval: POLL,
  });
  const cases = useLedgerQuery({
    queryKey: ["ws-cases"],
    queryFn: wapi.cases,
    enabled: has("cases.read"),
    refetchInterval: POLL,
  });
  const inbox = useLedgerQuery({
    queryKey: ["inbox"],
    queryFn: api.workbench.inbox,
    enabled: !enterprise && scope.inbox,
    refetchInterval: POLL,
  });
  const notices = useLedgerQuery({
    queryKey: ["notices-active"],
    queryFn: () =>
      ledgerRequest<{ items: SystemNotice[] }>("/system-notices/active"),
    refetchInterval: POLL,
  });
  const unreadMessages = (messages.data?.items ?? []).filter((m) => m.unread);
  const openCases = (cases.data ?? []).filter(
    (c) => c.allowedActions.length > 0,
  );
  const pending = inbox.data?.items ?? [];
  return {
    messages,
    cases,
    inbox,
    notices,
    unreadMessages,
    openCases,
    pending,
    count: unreadMessages.length + openCases.length + pending.length,
  };
}
