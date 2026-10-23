"use client";

import { useState } from "react";
import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/operations-api";
import type { Subscription } from "@/lib/ledger/operations-types";
import { fmtDate, fmtMoney } from "@/lib/ledger/format";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { Guard } from "@/components/ledger/kit/guard";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, Section, Stat, StatRow } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export function BillingPage({ mode = "subscriptions" }: { mode?: "subscriptions" | "revenue" }) {
  return (
    <Guard permission="billing.read">
      <Billing mode={mode} />
    </Guard>
  );
}

import{useLedgerSession}from"@/lib/ledger/platform-access";import{CommandDialog,useDialog}from"@/components/ledger/kit/command-dialog";import{TextAreaField}from"@/components/ledger/kit/form-fields";import{FilterSelect}from"@/components/ledger/kit/filters";import{Button}from"@/components/ledger/ui/button";import{z}from"zod";import{reason}from"@/lib/ledger/platform-schemas";const renewalSchema=z.object({reason:reason()});
const SUB_TABS = ["", "ACTIVE", "EXPIRING", "GRACE", "RESTRICTED", "PENDING_PAYMENT", "CANCELLED"] as const;

function Billing({mode}:{mode:"subscriptions"|"revenue"}) {
 const [months,setMonths]=useState(12);const {can}=useLedgerSession();const renewal=useDialog<Subscription>();
  const revenue = useQuery({ queryKey: ["revenue", months], queryFn: () => api.billing.revenue(months) });
  const [status, setStatus] = useState<(typeof SUB_TABS)[number]>("");
  const subs = useQuery({ queryKey: ["subscriptions", status], queryFn: () => api.billing.subscriptions(status || undefined), enabled:mode!=="revenue" });
  const r = revenue.data;
  const max = r ? Math.max(...r.months.map((m) => m.paid + m.simulated), 1) : 1;

  const columns: Column<Subscription>[] = [
    { key: "org", header: tr("Tổ chức"), sort: (s) => s.organizationName ?? "", cell: (s) => <Link className="font-medium text-brand hover:underline" href={`/admin/directory/${s.organizationId}`} onClick={(e) => e.stopPropagation()}>{s.organizationName}</Link> },
    { key: "plan", header: tr("Gói"), cell: (s) => <span>{s.planName} <span className="font-mono text-[12px] text-ink-2">v{s.planVersion.version}</span></span> },
    { key: "fee", header: tr("Phí năm"), hideBelow: "md", cell: (s) => <span className="font-mono text-[12px]">{fmtMoney(s.planVersion.annualFee)}</span> },
    { key: "ends", header: tr("Kết thúc"), sort: (s) => s.endsAt ?? "9", cell: (s) => <span className="flex flex-col"><span className="font-mono text-[12px]">{fmtDate(s.endsAt)}</span>{s.daysRemaining !== null && <span className={cn("text-[11.5px]", s.daysRemaining < 0 ? "text-danger" : s.daysRemaining < 30 ? "text-warn" : "text-ink-2")}>{s.daysRemaining < 0 ? tr("quá {p0} ngày", { p0: -s.daysRemaining }) : tr("còn {p0} ngày", { p0: s.daysRemaining })}</span>}</span> },
    { key: "grace", header: tr("Hết ân hạn"), hideBelow: "lg", cell: (s) => <span className="font-mono text-[12px] text-ink-2">{fmtDate(s.graceEndsAt)}</span> },
    { key: "status", header: tr("Hiệu lực"), cell: (s) => <Status group="subscription" value={s.effectiveStatus} /> },
  ];

 columns.push({key:"renewal",header:tr("Gia hạn"),cell:s=>can("billing.write")?<Button size="xs" variant="outline" onClick={e=>{e.stopPropagation();renewal.open(s)}}>{tr("Phát hành hóa đơn gia hạn")}</Button>:null});
 return (
    <>
      <PageHeader actions={<div className="flex flex-wrap gap-2"><Link href="/admin/billing">{tr("Bảng giá dịch vụ")}</Link><Link href="/admin/billing/invoices">{tr("Hóa đơn")}</Link><Link href={mode==="revenue"?"/admin/billing/subscriptions":"/admin/billing/revenue"}>{tr(mode==="revenue"?"Thuê bao":"Doanh thu")}</Link></div>} title={tr("Doanh thu & thuê bao")} description={tr("Trạng thái hiệu lực suy ra từ ngày kết thúc: Hiệu lực → Ân hạn (billing.graceDays) → Bị hạn chế. RESTRICTED chặn tạo mới nhưng không chặn giao nhận đang dở hay trang QR công khai.")} />
      <PageBody><FilterSelect label={tr("Số tháng")} value={String(months)} onChange={v=>setMonths(Number(v)||12)} options={Array.from({length:36},(_,i)=>i+1).map(n=>({value:String(n),label:String(n)}))}/>
        {revenue.error ? (
          <ErrorState error={revenue.error} onRetry={() => revenue.refetch()} />
        ) : !r ? (
          <LoadingRows rows={3} />
        ) : (
          <>
            <StatRow>
              <Stat label={tr("Đã thu (thật) 12 tháng")} value={fmtMoney(r.paidTotal)} />
              <Stat label={tr("Mô phỏng (không phải tiền thật)")} value={fmtMoney(r.simulatedTotal)} hint={tr("Thanh toán giả lập local")} />
              <Stat label={tr("Chờ thanh toán")} value={fmtMoney(r.outstandingTotal)} href="/admin/billing/invoices" />
              <Stat label={tr("Quá hạn")} value={fmtMoney(r.overdueTotal)} tone={r.overdueTotal ? "danger" : undefined} href="/admin/billing/invoices" />
              <Stat label={tr("Gói hiệu lực")} value={r.activeSubscriptions} hint={tr("{p0} sắp hết hạn", { p0: r.expiringIn30Days })} />
            </StatRow>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              <Section title={tr("Thu theo tháng")} aside={<span className="flex items-center gap-3"><span className="flex items-center gap-1"><span className="size-2.5 rounded-[2px] bg-brand" />{tr("Thật")}</span><span className="flex items-center gap-1"><span className="size-2.5 rounded-[2px] bg-line-strong" />{tr("Mô phỏng")}</span></span>}>
                <div className="flex h-40 items-end gap-2 px-5 pt-4" role="img" aria-label={tr("Biểu đồ doanh thu 12 tháng")}>
                  {r.months.map((m) => (
                    <div key={m.month} className="flex h-full flex-1 flex-col justify-end" title={tr("{p0}: {p1} thật, {p2} mô phỏng", { p0: m.month, p1: fmtMoney(m.paid), p2: fmtMoney(m.simulated) })}>
                      <div className="w-full rounded-t-[2px] bg-line-strong" style={{ height: `${(m.simulated / max) * 100}%` }} />
                      <div className={cn("w-full bg-brand", !m.simulated && "rounded-t-[2px]")} style={{ height: `${(m.paid / max) * 100}%` }} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 px-5 pt-1 pb-3">
                  {r.months.map((m) => (
                    <span key={m.month} className="flex-1 text-center font-mono text-[10.5px] text-ink-2">{m.month.slice(5)}</span>
                  ))}
                </div>
              </Section>
              <Section title={tr("Theo gói")}>
                {r.byPlan.length ? (
                  <ul className="divide-y divide-line/70">
                    {r.byPlan.map((p) => (
                      <li key={p.planCode} className="flex items-center justify-between gap-2 px-4 py-2.5 text-[13px] sm:px-5">
                        <span className="font-mono text-[12px]">{p.planCode}</span>
                        <span className="font-mono text-[12px]">{fmtMoney(p.amount)} <span className="text-ink-2">· {p.count} {tr("HĐ")}</span></span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={tr("Chưa có thu")} />
                )}
                <p className="border-t border-line/70 px-4 py-2.5 text-[12px] text-ink-2 sm:px-5">{r.note}</p>
              </Section>
            </div>
          </>
        )}
        {mode!=="revenue"&&<Section title={tr("Thuê bao")} bodyClassName="flex flex-col">
          <div className="flex gap-1 overflow-x-auto border-b border-line/70 px-4 py-2.5 sm:px-5">
            {SUB_TABS.map((t) => (
              <button key={t || "all"} type="button" onClick={() => setStatus(t)} className={cn("h-7 shrink-0 rounded-md border px-2.5 text-[12px] font-medium", status === t ? "border-ink bg-ink text-canvas" : "border-line")}>
                {t ? { ACTIVE: tr("Hiệu lực"), EXPIRING: tr("Sắp hết hạn"), GRACE: tr("Ân hạn"), RESTRICTED: tr("Bị hạn chế"), PENDING_PAYMENT: tr("Chờ thanh toán"), CANCELLED:tr("Đã hủy") }[t] : tr("Tất cả")}
              </button>
            ))}
          </div>
          <DataTable rows={subs.data} loading={subs.isLoading} error={subs.error} onRetry={() => subs.refetch()} columns={columns} rowKey={(s) => s.id} href={(s) => `/admin/directory/${s.organizationId}`} empty={<EmptyState title={tr("Không có thuê bao")} />} />
        </Section>
        }
<CommandDialog {...renewal.props} title={tr("Phát hành hóa đơn gia hạn")} endpoint="POST /platform-billing/organizations/:id/renewal-invoices" schema={renewalSchema} defaultValues={{reason:""}} submitLabel={tr("Phát hành")} invalidate={[["subscriptions"],["invoices"]]} run={(v,cmd)=>api.billing.renewal(renewal.target!.organizationId,{planCode:renewal.target!.planCode,reason:v.reason},cmd)}>{f=><TextAreaField control={f.control} name="reason" label={tr("Lý do")}/>}</CommandDialog>
        <Callout>
          {tr("NAPAS/QR thu tiền và ký hợp đồng điện tử có giá trị pháp lý")} <strong>{tr("chưa được triển khai")}</strong> {tr("trong Backend; thanh toán chỉ là mô phỏng local hoặc admin xác nhận chuyển khoản.")}
        </Callout>
      </PageBody>
    </>
  );
}
