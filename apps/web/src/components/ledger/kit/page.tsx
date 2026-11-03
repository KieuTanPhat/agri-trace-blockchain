"use client";

import Link from "next/link";
import { AlertTriangle, Inbox, Lock, RefreshCw } from "lucide-react";
import { getLedgerError } from "@/lib/ledger/errors";
import { Button } from "@/components/ledger/ui/button";
import { Skeleton } from "@/components/ledger/ui/skeleton";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export function PageHeader({
  title,
  description,
  actions,
  crumbs,
  meta,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  crumbs?: { href?: string; label: string }[];
  meta?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line bg-card px-4 py-4 sm:px-7">
      {crumbs && (
        <nav aria-label={tr("Vị trí")} className="flex flex-wrap items-center gap-1.5 text-[12px] text-ink-2">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              {c.href ? (
                <Link className="text-brand hover:text-brand-ink hover:underline" href={c.href}>
                  {c.label}
                </Link>
              ) : (
                <span className="text-ink">{c.label}</span>
              )}
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{title}</h1>
            {meta}
          </div>
          {description && <p className="max-w-3xl text-[13px] text-ink-2">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

export function PageBody({ children, className, wide }: { children: React.ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-5 px-4 py-5 sm:px-7", wide ? "max-w-[1600px]" : "max-w-[1360px]", className)}>{children}</div>;
}

export function Section({
  title,
  aside,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-md border border-line bg-card", className)}>
      {title && (
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {aside && <div className="text-[12px] text-ink-2">{aside}</div>}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

/** Lưới thuật ngữ — giá trị dạng dl. */
export function Fields({ children, cols = 2, className }: { children: React.ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const grid = { 1: "", 2: "sm:grid-cols-2", 3: "sm:grid-cols-2 lg:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <dl className={cn("grid grid-cols-1 gap-x-8 gap-y-3.5 px-4 py-4 text-[13px] sm:px-5", grid, className)}>{children}</dl>;
}
export function Field({ label, children, mono, className }: { label: string; children: React.ReactNode; mono?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-[12px] text-ink-2">{label}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-[12px]")}>{children ?? "—"}</dd>
    </div>
  );
}

export function Callout({ tone = "neutral", title, children, icon, className }: { tone?: "neutral" | "warn" | "danger" | "info" | "ok"; title?: string; children: React.ReactNode; icon?: React.ReactNode; className?: string }) {
  const cls = {
    neutral: "bg-sunken text-ink",
    warn: "bg-warn-bg text-warn",
    danger: "bg-danger-bg text-danger",
    info: "bg-info-bg text-info",
    ok: "bg-ok-bg text-ok",
  }[tone];
  return (
    <div role="note" className={cn("flex gap-2.5 rounded-md px-3 py-2.5 text-[13px] leading-relaxed", cls, className)}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div className={cn(title && "mt-0.5", tone !== "neutral" && "text-ink")}>{children}</div>
      </div>
    </div>
  );
}

export function ReadOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <Callout icon={<Lock className="size-3.5 text-ink-2" />}>
      <span className="text-ink-2">{children}</span>
    </Callout>
  );
}

export function EmptyState({ title = tr("Không có dữ liệu"), children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox aria-hidden className="size-6 text-ink-2/70" />
      <div className="text-[14px] font-medium">{title}</div>
      {children && <p className="max-w-md text-[13px] text-ink-2">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const e = getLedgerError(error);
  const forbidden = e?.status === 403;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 text-center", compact ? "py-6" : "py-12")}>
      <AlertTriangle aria-hidden className={cn("size-6", forbidden ? "text-warn-dot" : "text-danger")} />
      <div className="text-[14px] font-medium">{forbidden ? tr("Vai hiện tại không có quyền xem mục này") : tr("Không tải được dữ liệu")}</div>
      <p className="max-w-md text-[13px] text-ink-2">
        {e ? e.message : tr("Đã xảy ra lỗi không xác định.")}
        {e?.requestId && <span className="mt-1 block font-mono text-[11px]">requestId {e.requestId}</span>}
      </p>
      {onRetry && !forbidden && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> {tr("Thử lại")}
        </Button>
      )}
    </div>
  );
}

export function LoadingRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2 p-4", className)} aria-busy="true" aria-label={tr("Đang tải")}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" style={{ opacity: 1 - i * 0.1 }} />
      ))}
    </div>
  );
}

/** Ô số liệu: số lớn + nhãn, không trang trí. */
export function Stat({ label, value, hint, tone, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "danger" | "warn" | "ok"; href?: string }) {
  const body = (
    <>
      <div className="text-[12px] text-ink-2">{label}</div>
      <div className={cn("font-mono text-[22px] leading-none font-medium tracking-tight", tone === "danger" && "text-danger", tone === "warn" && "text-warn", tone === "ok" && "text-ok")}>{value}</div>
      {hint && <div className="text-[12px] text-ink-2">{hint}</div>}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1.5 px-4 py-3.5";
  return href ? (
    <Link href={href} className={cn(cls, "hover:bg-row-alt")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
export function StatRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 divide-line rounded-md border border-line bg-card sm:grid-cols-3 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none [&>*]:border-line [&>*:not(:first-child)]:border-l max-lg:[&>*]:border-b", className)}>{children}</div>;
}
