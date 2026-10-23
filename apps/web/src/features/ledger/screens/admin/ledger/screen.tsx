"use client";

import { useState } from "react";
import { keepPreviousData, useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/operations-api";
import type { LedgerTx } from "@/lib/ledger/operations-types";
import { fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect, useDebounced } from "@/components/ledger/kit/filters";
import { Guard } from "@/components/ledger/kit/guard";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, ReadOnlyNote, Section, Stat, StatRow } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
function LedgerPage() {
  return (
    <Guard permission="ledger.read">
      <Ledger />
    </Guard>
  );
}

import{Sheet,SheetContent,SheetTitle,SheetHeader,SheetDescription}from"@/components/ledger/ui/sheet";import{Fields,Field}from"@/components/ledger/kit/page";
function Ledger() {
  const o = useQuery({ queryKey: ["ledger"], queryFn: api.ops.ledger });
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const tx = useQuery({ queryKey: ["ledger-tx", status, q], queryFn: () => api.ops.ledgerTransactions({ status: status || undefined, q: q || undefined }), placeholderData: keepPreviousData });
  const d = o.data;const [selected,setSelected]=useState<LedgerTx|null>(null);
  const columns: Column<LedgerTx>[] = [
    { key: "event", header: tr("Sự kiện"), cell: (t) => <span className="flex flex-col"><span className="font-mono text-[12px]">{t.eventType}</span><span className="text-[11.5px] text-ink-2">{t.organizationName ?? "—"} · {t.entityType}</span></span> },
    { key: "tx", header: "txId", cell: (t) => <span className="font-mono text-[11.5px]">{t.txId ? `${t.txId.slice(0, 16)}…` : "—"}</span> },
    { key: "hash", header: "dataHash", hideBelow: "lg", cell: (t) => <span className="font-mono text-[11.5px] text-ink-2">{t.dataHash.slice(0, 12)}…</span> },
    { key: "channel", header: tr("Kênh"), hideBelow: "md", cell: (t) => <span className="font-mono text-[12px]">{t.channelId}</span> },
    { key: "att", header: tr("Lượt"), cell: (t) => <span className="font-mono text-[12px]">{t.attempts}</span> },
    { key: "at", header: tr("Ghi nhận"), sort: (t) => t.recordedAt ?? t.createdAt, cell: (t) => <span className="font-mono text-[12px]">{fmtDateTime(t.recordedAt ?? t.createdAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (t) => <Status group="tx" value={t.status} /> },
  ];
  return (
    <>
      <PageHeader title={tr("Sổ cái blockchain")} description={tr("Tuyến ghi, binding mạng Fabric theo chuỗi và bằng chứng giao dịch. Chỉ đọc — đối soát với ledger thật theo Hybrid runbook.")} />
      <PageBody wide>
        {o.error ? (
          <ErrorState error={o.error} onRetry={() => o.refetch()} />
        ) : !d ? (
          <LoadingRows rows={4} />
        ) : (
          <>
            <StatRow>
              <Stat label={tr("Bằng chứng đã xác nhận")} value={fmtNumber(d.proofs.CONFIRMED ?? 0)} tone="ok" />
              <Stat label={tr("Chờ xác nhận")} value={fmtNumber(d.proofs.PENDING ?? 0)} />
              <Stat label={tr("Thất bại")} value={fmtNumber(d.proofs.FAILED ?? 0)} tone={d.proofs.FAILED ? "danger" : undefined} />
              <Stat label={tr("Hold chưa xử lý")} value={d.unresolvedHolds} tone={d.unresolvedHolds ? "warn" : undefined} />
              <Stat label={tr("Chờ lâu nhất")} value={tr("{p0} phút", { p0: d.oldestPendingAgeMinutes })} />
            </StatRow>
            {d.lastFailure && (
              <Callout tone="danger" title={tr("Lỗi gần nhất · {p0} · {p1}", { p0: d.lastFailure.status, p1: fmtDateTime(d.lastFailure.at) })}>
                <span className="font-mono text-[12px]">{d.lastFailure.error}</span>
              </Callout>
            )}
<Section title={tr("Tuyến ghi sổ cái")} className="min-w-0"><DataTable rows={d.routes} rowKey={r=>r.digest} columns={[{key:"digest",header:"Digest",cell:r=><span className="break-all font-mono text-[12px]">{r.digest}</span>},{key:"mode",header:tr("Chế độ"),cell:r=>r.mode},{key:"network",header:tr("Mạng"),cell:r=>r.network},{key:"channel",header:tr("Kênh"),cell:r=>r.channelId},{key:"chaincode",header:"Chaincode / Contract",cell:r=>r.chaincodeName+" / "+r.contractName},{key:"writer",header:"Writer MSP",cell:r=>r.writerMspId},{key:"createdAt",header:tr("Tạo lúc"),cell:r=>fmtDateTime(r.createdAt)}]}/></Section>
<div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">{[{name:"Outbox",counts:d.outbox},{name:"Ledger control job",counts:d.controlJobs}].map(group=><Section key={group.name} title={group.name}><dl className="flex flex-wrap gap-5 px-5 py-3">{Object.entries(group.counts).map(([status,count])=><div key={status}><dt className="text-[12px] text-ink-2">{status}</dt><dd className="font-mono">{count}</dd></div>)}</dl></Section>)}</div>
{d.lastConfirmed&&<Callout title={tr("Bằng chứng xác nhận gần nhất")}><span className="break-all font-mono text-[12px]">{d.lastConfirmed.txId}</span> · {fmtDateTime(d.lastConfirmed.at)}</Callout>}
            <Section title={tr("Binding theo chuỗi")}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                      <th className="h-9 px-4 font-semibold">{tr("Chuỗi")}</th>
                      <th className="px-3 font-semibold">Digest</th>
                      <th className="px-3 font-semibold">{tr("Kênh · chaincode")}</th>
                      <th className="px-3 font-semibold">Writer MSP</th>
                      <th className="px-3 font-semibold">{tr("Khỏe lần cuối")}</th>
                      <th className="px-3 font-semibold">{tr("Chứng thư hết hạn")}</th>
                      <th className="px-4 font-semibold">{tr("Trạng thái")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bindings.map((b) => (
                      <tr key={b.digest} className="border-b border-line/70 last:border-0">
                        <td className="h-11 px-4">{b.chainName}</td>
                        <td className="px-3 font-mono text-[12px]">{b.digest}</td>
                        <td className="px-3 font-mono text-[12px]">{b.channelId} · {b.chaincodeName}</td>
                        <td className="px-3 font-mono text-[12px]">{b.writerMspId}</td>
                        <td className="px-3 font-mono text-[12px]">{fmtDateTime(b.lastHealthyAt)}{b.lastErrorCode && <span className="block text-danger">{b.lastErrorCode}</span>}</td>
                        <td className="px-3 font-mono text-[12px]">{fmtDateTime(b.certificateExpiresAt)}</td>
                        <td className="px-4"><Status group="chain" value={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </>
        )}
        <Section title={tr("Giao dịch gần đây")} aside={tr("Tối đa 200 dòng · tìm theo txId hoặc tiền tố dataHash")}>
          <div className="border-b border-line/70 px-4 py-2.5 sm:px-5">
            <FilterBar search={text} onSearch={setText} placeholder={tr("txId hoặc dataHash")} active={!!(status || text)} onReset={() => (setStatus(""), setText(""))}>
              <FilterSelect label={tr("Trạng thái")} value={status} onChange={setStatus} options={[{ value: "PENDING", label: tr("Chờ xác nhận") }, { value: "CONFIRMED", label: tr("Đã xác nhận") }, { value: "FAILED", label: tr("Thất bại") }]} />
            </FilterBar>
          </div>
          <DataTable onRowClick={setSelected} rows={tx.data} loading={tx.isLoading} error={tx.error} onRetry={() => tx.refetch()} columns={columns} rowKey={(t) => t.eventId} empty={<EmptyState title={tr("Không có giao dịch")} />} />
        </Section>
<Sheet open={!!selected} onOpenChange={v=>!v&&setSelected(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{tr("Chi tiết giao dịch")}</SheetTitle><SheetDescription>{tr("Bằng chứng do API trả về")}</SheetDescription></SheetHeader><Fields cols={1}>{selected&&Object.entries(selected).map(([key,value])=><Field key={key} label={key} mono><span className="break-all">{value===null?"—":String(value)}</span></Field>)}</Fields></SheetContent></Sheet>
        {d && <ReadOnlyNote>{d.note}</ReadOnlyNote>}
      </PageBody>
    </>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-ledger"><LedgerPage/></LedgerRouteScreen>;}
