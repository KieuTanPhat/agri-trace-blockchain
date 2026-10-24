"use client";

import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/ledger/operations-api";

import { fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useNow } from "@/lib/ledger/use-now";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { Guard } from "@/components/ledger/kit/guard";
import { Callout, ErrorState, LoadingRows, PageBody, PageHeader, ReadOnlyNote, Section, Stat, StatRow } from "@/components/ledger/kit/page";

function TraceReportPage() {
  return (
    <Guard permission="traceReport.read">
      <TraceReport />
    </Guard>
  );
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function TraceReport() {
  const q = useQuery({ queryKey: ["trace-report"], queryFn: () => api.ops.traceReport({}) });
  const r = q.data;
  const maxMonth = Math.max(1, ...(r?.months.map((m) => m.harvestLots + m.processedLots) ?? []));
  const maxEvent = Math.max(1, ...(r?.eventsByType.map((e) => e.count) ?? []));
  return (
    <>
      <PageHeader
        title={tr("Báo cáo truy xuất")}
        description={tr("Lô tạo mới theo tháng (thu hoạch và chế biến), sự kiện truy xuất theo loại và độ phủ bằng chứng blockchain trong 12 tháng. Có thể xuất dữ liệu khóa (KDE) theo lô ra CSV.")}
      />
      <PageBody wide>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !r ? (
          <LoadingRows rows={8} />
        ) : (
          <>
            <StatRow>
              <Stat label={tr("Sự kiện truy xuất")} value={fmtNumber(r.totalEvents)} />
              <Stat label={tr("Độ phủ bằng chứng")} value={`${r.proofCoveragePercent}%`} hint={tr("bằng chứng CONFIRMED / tổng sự kiện")} tone={r.proofCoveragePercent < 90 ? "warn" : "ok"} />
              {(["CONFIRMED", "PENDING", "FAILED"] as const).map((k) => (
                <Stat key={k} label={{ CONFIRMED: tr("Đã xác nhận"), PENDING: tr("Chờ xác nhận"), FAILED: tr("Thất bại") }[k]} value={fmtNumber(r.proofs[k] ?? 0)} tone={k === "FAILED" && r.proofs[k] ? "danger" : undefined} />
              ))}
            </StatRow>
            <div className="grid gap-5 lg:grid-cols-2">
              <Section title={tr("Lô tạo mới theo tháng")} aside={<span className="flex items-center gap-3 text-[11.5px] text-ink-2"><Legend className="bg-brand" label={tr("Thu hoạch")} /><Legend className="bg-info" label={tr("Chế biến")} /></span>}>
                <ul className="flex flex-col gap-1.5 px-4 py-3 sm:px-5" aria-label={tr("Lô tạo mới theo tháng")}>
                  {r.months.map((m) => (
                    <li key={m.month} className="grid grid-cols-[64px_minmax(0,1fr)_64px] items-center gap-3 text-[12.5px]">
                      <span className="font-mono text-ink-2">{m.month}</span>
                      <span className="flex h-2.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                        <span className="h-full bg-brand" style={{ width: `${(m.harvestLots / maxMonth) * 100}%` }} />
                        <span className="h-full bg-info" style={{ width: `${(m.processedLots / maxMonth) * 100}%` }} />
                      </span>
                      <span className="text-right font-mono">
                        {m.harvestLots} / {m.processedLots}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={tr("Sự kiện theo loại")} aside={tr("12 tháng gần nhất")}>
                {r.eventsByType.length ? (
                  <ul className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
                    {r.eventsByType.slice(0, 15).map((e) => (
                      <li key={e.eventType} className="grid grid-cols-[minmax(0,200px)_minmax(0,1fr)_48px] items-center gap-3 text-[12.5px]">
                        <span className="truncate font-mono text-[11.5px]" title={e.eventType}>{e.eventType}</span>
                        <span className="h-2 rounded-full bg-sunken" aria-hidden>
                          <span className="block h-full rounded-full bg-brand" style={{ width: `${(e.count / maxEvent) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono">{fmtNumber(e.count)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-4 text-[13px] text-ink-2">{tr("Không có dữ liệu")}</p>
                )}
              </Section>
            </div>
            <Export />
          </>
        )}
      </PageBody>
    </>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${className}`} aria-hidden />
      {label}
    </span>
  );
}

function Export() {
  const now = useNow();
  const [from, setFrom] = useState(() => day(now - 90 * 86_400_000));
  const [to, setTo] = useState(() => day(now));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invalid = !from || !to || from > to;
  async function run() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.ops.traceReport({ export: true, from, to });
      if (!r.csv || !r.fileName) throw new Error(tr("Không có dữ liệu"));
      const rows = r.csv.split("\r\n").length - 1;
      const url = URL.createObjectURL(new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = r.fileName;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(tr("Đã xuất {p0} dòng{p1}", { p0: rows, p1: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Section title={tr("Xuất dữ liệu khóa (KDE) theo lô")} aside="GET /platform-admin/trace-report?export=true">
      <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <p className="text-[13px] text-ink-2">
          {tr("Mỗi dòng là một lô tạo trong khoảng ngày: mã lô, sản phẩm, tổ chức, nguồn gốc (thu hoạch/chế biến), số lượng, chuỗi, lệnh chế biến và lô đầu vào, hạn dùng, trạng thái. Backend giới hạn 20.000 lô mỗi lần; mặc định 90 ngày gần nhất.")}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kde-from">{tr("Từ ngày")}</Label>
            <Input id="kde-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-[170px]" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kde-to">{tr("Đến ngày")}</Label>
            <Input id="kde-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-[170px]" />
          </div>
          <Button onClick={run} disabled={busy || invalid}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} {tr("Xuất CSV")}
          </Button>
        </div>
        {invalid && <p className="text-[12px] text-danger">{tr("Ngày bắt đầu phải trước hoặc bằng ngày kết thúc")}</p>}
        {error && <Callout tone="danger">{error}</Callout>}
        <ReadOnlyNote>{tr("Chỉ đọc. Tệp CSV được tạo từ dữ liệu trong DB tại thời điểm xuất, không phải bằng chứng Fabric.")}</ReadOnlyNote>
      </div>
    </Section>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-trace-report"><TraceReportPage/></LedgerRouteScreen>;}
