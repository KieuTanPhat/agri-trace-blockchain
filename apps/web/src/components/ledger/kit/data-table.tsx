"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ledger/ui/button";
import { cn } from "@/lib/ledger/utils";
import { EmptyState, ErrorState, LoadingRows } from "./page";

import { t as tr } from "@/lib/ledger/i18n";
export interface Column<R> {
  key: string;
  header: React.ReactNode;
  cell: (row: R) => React.ReactNode;
  sort?: (row: R) => string | number;
  className?: string;
  headClassName?: string;
  /** ẩn ở màn hình hẹp */
  hideBelow?: "sm" | "md" | "lg";
}

const hide = { sm: "max-sm:hidden", md: "max-md:hidden", lg: "max-lg:hidden" };

export function DataTable<R>({
  rows,
  columns,
  rowKey,
  href,
  onRowClick,
  selectedKey,
  loading,
  error,
  onRetry,
  empty,
  pageSize = 25,
  minWidth = 720,
  dense,
  caption,
  footer,
}: {
  rows: R[] | undefined;
  columns: Column<R>[];
  rowKey: (r: R) => string;
  href?: (r: R) => string;
  onRowClick?: (r: R) => void;
  selectedKey?: string | null;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  empty?: React.ReactNode;
  pageSize?: number | null;
  minWidth?: number;
  dense?: boolean;
  caption?: string;
  footer?: React.ReactNode;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(() => {
    if (!rows) return [];
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    return [...rows].sort((a, b) => {
      const x = col.sort!(a);
      const y = col.sort!(b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, columns]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const current = Math.min(page, pages - 1);
  const visible = pageSize ? sorted.slice(current * pageSize, (current + 1) * pageSize) : sorted;

  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (loading || !rows) return <LoadingRows />;
  if (rows.length === 0) return <>{empty ?? <EmptyState />}</>;

  const activate = (r: R) => {
    if (onRowClick) onRowClick(r);
    else if (href) router.push(href(r));
  };
  const interactive = !!(href || onRowClick);

  return (
    <div className="flex flex-col">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]" style={{ minWidth }}>
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr className="border-b border-line bg-sunken text-left">
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : undefined}
                    className={cn("relative h-9 px-3 text-[12px] font-semibold whitespace-nowrap text-ink-2 first:pl-4 last:pr-4", c.hideBelow && hide[c.hideBelow], c.headClassName)}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-ink"
                        onClick={() => setSort(active ? (sort!.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 })}
                      >
                        {c.header}
                        {active && (sort!.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const k = rowKey(r);
              const selected = selectedKey === k;
              return (
                <tr
                  key={k}
                  tabIndex={interactive ? 0 : undefined}
                  aria-selected={selected || undefined}
                  onClick={interactive ? () => activate(r) : undefined}
                  onKeyDown={interactive ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), activate(r)) : undefined}
                  className={cn(
                    "border-b border-line/70 last:border-b-0",
                    interactive && "cursor-pointer outline-none hover:bg-row-alt focus-visible:bg-brand-weak/60",
                    selected && "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak",
                  )}
                >
                  {columns.map((c) => (
                    <td key={c.key} className={cn("px-3 align-middle first:pl-4 last:pr-4", dense ? "h-9" : "h-11 py-1.5", c.hideBelow && hide[c.hideBelow], c.className)}>
                      {c.cell(r)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {(pageSize && sorted.length > pageSize) || footer ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px] text-ink-2">
          <span>
            {pageSize && sorted.length > pageSize
              ? `${current * pageSize + 1}–${Math.min((current + 1) * pageSize, sorted.length)} / ${sorted.length}`
              : tr("{p0} dòng", { p0: sorted.length })}
          </span>
          {footer}
          {pageSize && sorted.length > pageSize && (
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={tr("Trang trước")} disabled={current === 0} onClick={() => setPage(current - 1)}>
                <ChevronLeft />
              </Button>
              <span className="font-mono">
                {current + 1}/{pages}
              </span>
              <Button variant="ghost" size="icon-sm" aria-label="Trang sau" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
                <ChevronRight />
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
