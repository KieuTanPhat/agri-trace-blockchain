"use client";
import Link from "next/link";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { useNotificationFeed } from "@/lib/ledger/notifications";
import { fmtAgo } from "@/lib/ledger/format";
import { INBOX_KIND_LABEL, label } from "@/lib/ledger/labels";
import { t } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

type Row = {
  key: string;
  href?: string;
  title: string;
  detail?: string | null;
  at?: string;
  unread?: boolean;
  tag?: string;
};

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="divide-y divide-line/70">
      {rows.map((row) => {
        const content = (
          <>
            <span
              aria-hidden
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                row.unread ? "bg-brand" : "bg-transparent",
              )}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span
                className={cn(
                  "line-clamp-1 text-[13px]",
                  row.unread ? "font-semibold" : "font-medium",
                )}
              >
                {row.title}
              </span>
              {row.detail && (
                <span className="line-clamp-2 text-[12px] whitespace-pre-line text-ink-2">
                  {row.detail}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-1">
              {row.tag && <Badge tone="neutral">{row.tag}</Badge>}
              {row.at && (
                <span className="text-[11.5px] text-ink-2">
                  {fmtAgo(row.at)}
                </span>
              )}
            </span>
          </>
        );
        const className = "flex items-start gap-3 px-4 py-3";
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className={cn(className, "hover:bg-row-alt")}>
                {content}
              </Link>
            ) : (
              <div className={className}>{content}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Feed({ feed }: { feed: ReturnType<typeof useNotificationFeed> }) {
  const { messages, cases, inbox, notices } = feed;
  const failed = [messages, cases, inbox, notices].find((q) => q.error);
  const loading = [messages, cases, inbox, notices].some((q) => q.isLoading);
  const sections: { title: string; rows: Row[] }[] = [
    {
      title: t("Thông báo nội bộ chưa đọc"),
      rows: feed.unreadMessages.map((m) => ({
        key: m.id,
        href: "/enterprise/messages",
        title: m.subject,
        detail: `${m.lastAuthorName ?? ""}: ${m.preview}`,
        at: m.lastMessageAt,
        unread: true,
      })),
    },
    {
      title: t("Sự cố cần xử lý"),
      rows: feed.openCases.map((c) => ({
        key: c.id,
        href: "/enterprise/inbox",
        title: c.title,
        tag: label("case", c.status)[0],
        unread: true,
      })),
    },
    {
      title: t("Việc chờ quyết định"),
      rows: feed.pending.map((i) => ({
        key: `${i.kind}:${i.id}`,
        href: i.href,
        title: i.title,
        detail: i.organizationName,
        at: i.createdAt,
        tag: INBOX_KIND_LABEL[i.kind] ?? i.kind,
        unread: i.overdue,
      })),
    },
    {
      title: t("Thông báo hệ thống"),
      rows: (notices.data?.items ?? []).map((n) => ({
        key: n.id,
        title: n.title,
        detail: n.body,
      })),
    },
  ].filter((s) => s.rows.length);
  if (failed?.error)
    return <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />;
  if (loading && !sections.length) return <LoadingRows />;
  if (!sections.length)
    return (
      <EmptyState title={t("Không có thông báo mới")} />
    );
  return (
    <>
      {sections.map((s) => (
        <Section key={s.title} title={`${s.title} (${s.rows.length})`}>
          <Rows rows={s.rows} />
        </Section>
      ))}
    </>
  );
}

export function EnterpriseNotifications() {
  const { access } = useWorkspaceAccess();
  const feed = useNotificationFeed({
    kind: "enterprise",
    permissions: access?.permissions ?? [],
  });
  return (
    <>
      <PageHeader
        title={t("Thông báo")}
        description={t("Tin nội bộ chưa đọc, sự cố được giao và thông báo hệ thống.")}
      />
      <PageBody>
        <Feed feed={feed} />
      </PageBody>
    </>
  );
}

export function PlatformNotifications() {
  const { canRoute } = useLedgerSession();
  const feed = useNotificationFeed({
    kind: "platform",
    inbox: canRoute("/admin/inbox"),
  });
  return (
    <>
      <PageHeader
        title={t("Thông báo")}
        description={t("Việc chờ quyết định và thông báo hệ thống.")}
      />
      <PageBody>
        <Feed feed={feed} />
      </PageBody>
    </>
  );
}
