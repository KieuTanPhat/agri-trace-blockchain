"use client";

import Link from "next/link";
import { useState } from "react";
import { z } from "zod";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { distApi } from "@/lib/ledger/dist-api";
import type { StockLot } from "@/lib/ledger/dist-types";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

/** Role queues (ADR-005): pre-filtered views of distribution work that
 * already exists, never new records. */
type Task = Awaited<ReturnType<typeof distApi.tasks>>["transfers"][number];

export const TASK_ACTION: Record<string, string> = localized({
  CONSENT: "Đồng thuận bàn giao",
  PICKUP: "Ký lấy hàng",
  DELIVERY: "Ký giao nhận hàng",
  ACTUAL_RECEIPT: "Ghi lượng thực nhận",
  SIGN_RETURN: "Ký trả hàng",
  RECONCILE_REMAINDER: "Đối soát hàng còn lại",
});
const TASK_ROLE: Record<string, string> = localized({ SENDER: "Bên gửi", CARRIER: "Vận chuyển", RECEIVER: "Bên nhận" });
const TABS = ["RECEIVE", "ALL"] as const;

export function InboundPage() {
  const { can } = useWorkspaceAccess();
  const [tab, setTab] = useState<(typeof TABS)[number]>("RECEIVE");
  const tasks = useQuery({ queryKey: ["dist-tasks"], queryFn: distApi.tasks, enabled: can("distribution.read") });
  if (!can("distribution.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền distribution.read"))} />;
  const all = tasks.data?.transfers ?? [];
  // Receiving covers the receiver's signatures and the carrier's pickup.
  const receiving = all.filter((t) => t.role === "RECEIVER" || (t.role === "CARRIER" && t.action === "PICKUP"));
  const rows = tab === "RECEIVE" ? receiving : all;
  const cols: Column<Task>[] = [
    { key: "action", header: tr("Việc cần làm"), cell: (t) => <Badge tone={t.action === "ACTUAL_RECEIPT" || t.action === "DELIVERY" ? "warn" : "info"}>{TASK_ACTION[t.action] ?? t.action}</Badge> },
    { key: "route", header: tr("Tuyến"), cell: (t) => <span className="text-[13px]">{t.origin} → {t.destination}</span> },
    { key: "role", header: tr("Vai trò của mình"), hideBelow: "md", cell: (t) => <span className="text-[12px] text-ink-2">{TASK_ROLE[t.role] ?? t.role}</span> },
    { key: "date", header: tr("Tạo lúc"), hideBelow: "md", cell: (t) => <span className="font-mono text-[12px]">{fmtDateTime(t.createdAt)}</span> },
    { key: "open", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (t) => <Button asChild size="xs" variant="outline"><Link href={`/distribution/${t.transferId}`}>{tr("Mở phiếu")}</Link></Button> },
  ];
  return (
    <>
      <PageHeader title={tr("Hàng chờ nhận")} description={tr("Phiếu giao nhận đang chờ doanh nghiệp bạn ký nhận, ghi lượng thực nhận hoặc ký các bước bàn giao khác.")} />
      <PageBody className="min-w-0">
        <div role="tablist" className="flex flex-wrap gap-1">
          {TABS.map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {k === "RECEIVE" ? tr("Chờ mình nhận") : tr("Mọi việc cần ký")}
              <span className="ml-1.5 font-mono text-[11px] opacity-70">{k === "RECEIVE" ? receiving.length : all.length}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={tasks.isLoading ? undefined : rows} loading={tasks.isLoading} error={tasks.error} onRetry={() => tasks.refetch()} columns={cols} rowKey={(t) => `${t.transferId}:${t.action}`} empty={<EmptyState title={tr("Không có hàng chờ nhận")} />} />
        </div>
      </PageBody>
    </>
  );
}

const DEC = /^\d{1,11}(\.\d{1,3})?$/;
const qty = z.string().regex(DEC, { error: () => tr("Số không âm, tối đa 3 chữ số thập phân") }).refine((v) => Number(v) > 0, { error: () => tr("Phải lớn hơn 0") });

/** Retail selling desk: lots on hand that may be sold, and a sale command. */
export function SalesPage() {
  const { can } = useWorkspaceAccess();
  const report = useQuery({ queryKey: ["dist-report", "sales"], queryFn: () => distApi.report({}), enabled: can("reports.read") });
  const sell = useDialog<StockLot>();
  if (!can("reports.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền reports.read"))} />;
  const lots = (report.data?.lots ?? []).filter((l) => Number(l.held) > 0);
  const blocked = (l: StockLot) => l.blocked || l.notices.some((n) => n.kind === "RECALL") || (!!l.expiryDate && l.expiryDate.slice(0, 10) < new Date().toISOString().slice(0, 10));
  const cols: Column<StockLot>[] = [
    { key: "lot", header: tr("Lô"), cell: (l) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{l.lotCode}</span><span className="text-[12px] text-ink-2">{l.productName}</span></span> },
    { key: "available", header: tr("Khả dụng"), cell: (l) => <span className="font-mono text-[12.5px]">{fmtNumber(l.available)} {l.unit}</span> },
    { key: "sites", header: tr("Theo cơ sở"), hideBelow: "lg", cell: (l) => <span className="text-[12px]">{l.siteHoldings.length ? l.siteHoldings.map((s) => `${s.siteName}: ${fmtNumber(s.available)}`).join(" · ") : "—"}</span> },
    { key: "expiry", header: tr("Hạn dùng"), hideBelow: "md", cell: (l) => <span className="font-mono text-[12px]">{l.expiryDate ? fmtDate(l.expiryDate) : "—"}</span> },
    { key: "state", header: tr("Trạng thái"), cell: (l) => blocked(l) ? <Badge tone="danger">{l.notices.some((n) => n.kind === "RECALL") ? tr("Thu hồi") : l.blocked ? tr("Bị chặn") : tr("Hết hạn")}</Badge> : <Badge tone="ok">{tr("Đang bán")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (l) => can("quantity.adjust") && !blocked(l) && Number(l.available) > 0 ? <Button size="xs" onClick={() => sell.open(l)}>{tr("Ghi bán")}</Button> : null },
  ];
  const lot = sell.target;
  const sites = (lot?.siteHoldings ?? []).filter((s) => Number(s.available) > 0);
  return (
    <>
      <PageHeader title={tr("Bán hàng")} description={tr("Lô đang bày bán tại cửa hàng. Ghi bán trừ tồn theo lô; lô bị thu hồi, bị chặn hoặc hết hạn thì không bán được.")} />
      <PageBody className="min-w-0">
        {!can("quantity.adjust") && <Callout tone="info">{tr("Bạn chỉ xem được tồn; ghi bán cần quyền điều chỉnh khối lượng.")}</Callout>}
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={report.isLoading ? undefined : lots} loading={report.isLoading} error={report.error} onRetry={() => report.refetch()} columns={cols} rowKey={(l) => l.lotId} empty={<EmptyState title={tr("Chưa có lô nào để bán")} />} />
        </div>
      </PageBody>
      {lot && (
        <CommandDialog {...sell.props} title={tr("Ghi bán · {p0}", { p0: lot.lotCode })} endpoint="POST /distribution/quantities" description={lot.productName} schema={z.object({ siteId: z.string(), quantity: qty, reason: z.string().trim().min(3, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 3 }) }).max(500) })} defaultValues={{ siteId: sites[0]?.siteId ?? "", quantity: "", reason: tr("Bán cho người tiêu dùng") }} version={lot.version} submitLabel={tr("Ghi bán")} invalidate={[["dist-report"], ["dist-tasks"], ["ws-lots"]]} run={(v, cmd) => distApi.dispose({ lotId: lot.lotId, unit: lot.unit, version: lot.version, kind: "SALE", quantity: v.quantity, reason: v.reason, siteId: v.siteId || undefined }, cmd)}>
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField control={f.control} name="siteId" label={tr("Cơ sở")} options={sites.map((s) => ({ value: s.siteId, label: `${s.siteName} · ${tr("khả dụng")} ${fmtNumber(s.available)}` }))} />
                <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: lot.unit })} inputMode="decimal" />
              </div>
              <TextAreaField control={f.control} name="reason" label={tr("Ghi chú")} max={500} />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}
