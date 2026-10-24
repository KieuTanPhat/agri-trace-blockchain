"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { ArrowRight, RefreshCw } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import type { InboxItem, InboxKind } from "@/lib/ledger/platform-api";
import { fmtDateTime, fmtDue, fmtSpan } from "@/lib/ledger/format";
import { INBOX_KIND_LABEL } from "@/lib/ledger/labels";
import { getInboxGuide, inboxHref } from "@/lib/ledger/platform-routes";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { Button } from "@/components/ledger/ui/button";
import { Guard } from "@/components/ledger/kit/guard";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
import { Due } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const TABS: (InboxKind | "ALL" | "OVERDUE")[] = [
  "ALL",
  "OVERDUE",
  "ENROLLMENT",
  "CAPABILITY",
  "AMENDMENT",
  "CONNECTION",
  "APPROVAL",
  "CASE",
  "TICKET",
  "CONSUMER_REPORT",
  "INVOICE_OVERDUE",
];

function PreviewScreen() {
  return (
    <Guard permission="inbox.read">
      <Inbox />
    </Guard>
  );
}

function Inbox() {
  const q = useQuery({ queryKey: ["inbox"], queryFn: api.workbench.inbox });
  const [tab, setTab] = useState<(typeof TABS)[number]>("ALL");
  const [selected, setSelected] = useState<string | null>(null);

  const items = useMemo(() => {
    const all = q.data?.items ?? [];
    if (tab === "ALL") return all;
    if (tab === "OVERDUE") return all.filter((i) => i.overdue);
    return all.filter((i) => i.kind === tab);
  }, [q.data, tab]);
  const current =
    items.find((i) => `${i.kind}:${i.id}` === selected) ?? items[0];

  const count = (t: (typeof TABS)[number]) =>
    (t === "ALL"
      ? q.data?.summary.total
      : t === "OVERDUE"
        ? q.data?.summary.overdue
        : q.data?.summary[t]) ?? 0;

  return (
    <>
      <PageHeader
        title={tr("Hàng đợi quyết định")}
        description={
          q.data
            ? tr(
                "{p0} việc chờ nền tảng · {p1} quá hạn · quá hạn lên trước, rồi cũ nhất trước",
                { p0: q.data.summary.total, p1: q.data.summary.overdue },
              )
            : tr(
                "Mọi việc đang chờ một quyết định của nền tảng, gom từ hồ sơ, phê duyệt, sự cố, hỗ trợ và hóa đơn.",
              )
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.refetch()}
            disabled={q.isFetching}
          >
            <RefreshCw className={cn(q.isFetching && "animate-spin")} />{" "}
            {tr("Làm mới")}
          </Button>
        }
      />
      <PageBody wide>
        <div
          role="tablist"
          aria-label={tr("Lọc theo loại việc")}
          className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
        >
          {TABS.filter(
            (t) => t === "ALL" || t === "OVERDUE" || count(t) > 0,
          ).map((t) => (
            <button
              key={t}
              role="tab"
              type="button"
              aria-selected={tab === t}
              onClick={() => {
                setTab(t);
                setSelected(null);
              }}
              className={cn(
                "flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-medium",
                tab === t
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-card hover:border-line-strong",
                t === "OVERDUE" && tab !== t && count(t) > 0 && "text-danger",
              )}
            >
              {t === "ALL"
                ? tr("Tất cả")
                : t === "OVERDUE"
                  ? tr("Quá hạn")
                  : INBOX_KIND_LABEL[t]}
              <span className="font-mono text-[11px] opacity-80">
                {count(t)}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[3_1_560px] overflow-hidden rounded-md border border-line bg-card">
            {q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : q.isLoading ? (
              <LoadingRows rows={8} />
            ) : items.length === 0 ? (
              <EmptyState
                title={
                  tab === "OVERDUE"
                    ? tr("Không có việc quá hạn")
                    : tr("Hàng đợi trống")
                }
              >
                {tr(
                  "Khi doanh nghiệp nộp hồ sơ, có đề xuất phê duyệt hoặc phản ánh mới, việc sẽ xuất hiện ở đây.",
                )}
              </EmptyState>
            ) : (
              <ul
                className="divide-y divide-line/70"
                aria-label={tr("Danh sách việc")}
              >
                {items.map((i) => {
                  const key = `${i.kind}:${i.id}`;
                  const on = current && `${current.kind}:${current.id}` === key;
                  const due = fmtDue(i.dueAt);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => setSelected(key)}
                        aria-current={on || undefined}
                        className={cn(
                          "grid w-full grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 text-left text-[13px] hover:bg-row-alt sm:grid-cols-[110px_minmax(0,2fr)_minmax(0,1.3fr)_64px_100px]",
                          on &&
                            "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak",
                        )}
                      >
                        <span className="text-[11px] font-semibold tracking-[0.04em] text-ink-2 uppercase">
                          {INBOX_KIND_LABEL[i.kind]}
                        </span>
                        <span className="truncate font-medium">{i.title}</span>
                        <span className="col-start-2 truncate text-ink-2 sm:col-start-auto">
                          {i.organizationName ?? "—"}
                        </span>
                        <span className="hidden font-mono text-[12px] text-ink-2 sm:block">
                          {fmtSpan(i.ageHours * 3_600_000)}
                        </span>
                        <span className="col-start-3 row-span-2 row-start-1 text-right sm:col-start-auto sm:row-span-1 sm:row-start-auto sm:text-left">
                          <Due overdue={due.overdue}>{due.text}</Due>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {current && <Detail item={current} />}
        </div>
      </PageBody>
    </>
  );
}

function Detail({ item }: { item: InboxItem }) {
  const guide = getInboxGuide(item.kind);
  const { canRoute } = useLedgerSession();
  const due = fmtDue(item.dueAt);
  return (
    <aside
      aria-label={tr("Chi tiết việc đang chọn")}
      className="flex min-w-0 flex-[2_1_320px] flex-col gap-4 rounded-md border border-line bg-card p-5 lg:sticky lg:top-[68px]"
    >
      <div className="flex flex-col gap-1">
        <span className="label-caps">{INBOX_KIND_LABEL[item.kind]}</span>
        <h2 className="text-[17px] leading-snug font-semibold">{item.title}</h2>
        <span className="text-[13px] text-ink-2">
          {item.organizationName ?? tr("Không gắn tổ chức")}
        </span>
      </div>
      <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-2 text-[13px]">
        <dt className="text-ink-2">{tr("Tạo lúc")}</dt>
        <dd className="font-mono text-[12px]">{fmtDateTime(item.createdAt)}</dd>
        <dt className="text-ink-2">{tr("Hạn xử lý")}</dt>
        <dd className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[12px]">
            {fmtDateTime(item.dueAt)}
          </span>
          {item.dueAt && <Due overdue={due.overdue}>{due.text}</Due>}
        </dd>
        <dt className="text-ink-2">{tr("Căn cứ hạn")}</dt>
        <dd className="font-mono text-[12px]">{guide.sla}</dd>
        <dt className="text-ink-2">{tr("Ai xử lý")}</dt>
        <dd>{guide.who}</dd>
      </dl>
      <p className="rounded-md bg-sunken px-3 py-2.5 text-[13px] leading-relaxed">
        {guide.rule}
      </p>
      <div className="flex flex-wrap gap-2">
        {canRoute(inboxHref(item)) ? (
          <Button asChild>
            <Link href={inboxHref(item)}>
              {tr("Mở để xử lý")} <ArrowRight />
            </Link>
          </Button>
        ) : (
          <p className="text-[13px] text-ink-2">
            {tr("Mục việc này cần người có quyền xử lý tương ứng.")}
          </p>
        )}
      </div>
    </aside>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-inbox">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
