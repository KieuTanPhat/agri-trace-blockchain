"use client";

import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/workspace-api";
import type { Revision } from "@/lib/ledger/workspace-types";
import { fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { EmptyState, ErrorState, LoadingRows } from "@/components/ledger/kit/page";

const HIDDEN = new Set(["id", "organizationId", "version", "createdAt", "updatedAt"]);

/** Lịch sử phiên bản: mỗi lần sửa lưu ảnh chụp bản trước kèm lý do (GET /enterprise-workspace/revisions/:entityType/:id). */
export function RevisionHistory({ entityType, id, rows }: { entityType: Revision["entityType"]; id: string; rows?: Revision[] }) {
  const q = useQuery({ queryKey: ["ws-revisions", entityType, id], queryFn: () => wapi.revisions(entityType, id), enabled: !rows });
  const [open, setOpen] = useState<string | null>(null);
  const data = rows ?? q.data;
  if (!rows && q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!data) return <LoadingRows rows={2} />;
  if (!data.length) return <EmptyState title={tr("Chưa có phiên bản trước")}>{tr("Mỗi lần chỉnh sửa, bản đang hiệu lực được lưu lại ở đây kèm lý do.")}</EmptyState>;
  return (
    <ol className="flex flex-col gap-2">
      {data.map((r) => (
        <li key={r.id} className="rounded-md border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="font-mono font-semibold">v{r.version}</span>
            <span className="font-mono text-ink-2">{fmtDateTime(r.createdAt)}</span>
            <Button size="xs" variant="ghost" className="ml-auto" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
              {open === r.id ? tr("Ẩn bản chụp") : tr("Xem bản chụp")}
            </Button>
          </div>
          <p className="mt-1 text-[13px]">{r.reason}</p>
          {open === r.id && (
            <dl className="mt-2 grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-1 border-t border-line/70 pt-2 text-[12px]">
              {Object.entries(r.snapshot)
                .filter(([k, v]) => !HIDDEN.has(k) && v !== null && v !== "" && !(Array.isArray(v) && !v.length))
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="truncate font-mono text-ink-2">{k}</dt>
                    <dd className="break-words">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                  </div>
                ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}
