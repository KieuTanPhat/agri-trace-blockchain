"use client";
import { publicTraceUrl } from "@/lib/site-origins";


import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { z } from "zod";
import {createQrMatrix,createQrSvgPath} from "@/lib/qr-code";
import {getTracePath} from "@/lib/trace-input";
import {LotHandovers} from "./lot-handovers";
import {HarvestRecoveryPanel} from "./harvest-recovery";
import {Callout} from "@/components/ledger/kit/page";
import { opsApi } from "@/lib/ledger/lot-api";
import type { InternalLot, LotCommand, Shipment } from "@/lib/ledger/lot-api";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { isoToLocal, localToIso } from "@/lib/ledger/ops-dates";
import { useNow } from "@/lib/ledger/use-now";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { LOT_STATE_LABEL, LOT_STATE_TONE, MOVEMENT_LABEL, ROLE_LABEL_BUSINESS, SHIPMENT_STATUS_LABEL, SHIPMENT_STATUS_TONE } from "@/lib/ledger/ops-labels";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { LineagePanel } from "@/components/ledger/workspace/lineage-panel";
import { cn } from "@/lib/ledger/utils";

const COMMAND_LABEL: Record<LotCommand, string> = localized({
  createShipment: "Tạo chuyến hàng",
  reportDamage: "Ghi hư hỏng",
  startTransport: "Bắt đầu vận chuyển",
  reportArrival: "Báo đã đến",
  receiveRetail: "Nhận hàng",
  rejectRetail: "Từ chối nhận",
  markForSale: "Bày bán",
  markSold: "Ghi đã bán",
  recall: "Thu hồi lô",
  expire: "Ghi hết hạn",
});
const reason = z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(1000);
const qty = z.coerce.number<number>({ error: () => tr("Nhập số") }).positive({ error: () => tr("Phải là số dương") });
const shipmentSchema = z.object({
  transporterOrgId: z.string().min(1, { error: () => tr("Chọn đơn vị vận chuyển") }),
  retailerOrgId: z.string().min(1, { error: () => tr("Chọn đơn vị bán lẻ") }),
  origin: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(500),
  destination: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(500),
  plannedPickupTime: z.string().optional(),
  expectedArrivalTime: z.string().optional(),
  vehicleRef: z.string().trim().max(100).optional(),
}).refine((v) => !v.plannedPickupTime || !v.expectedArrivalTime || v.expectedArrivalTime >= v.plannedPickupTime, { path: ["expectedArrivalTime"], error: () => tr("Dự kiến đến không trước dự kiến lấy hàng") });
const timeSchema = z.object({ occurredAt: z.string().min(1, { error: () => tr("Không được để trống") }) });
const reasonSchema = z.object({ reason });
const damageSchema = z.object({ quantity: qty, reason, evidenceRef: z.string().trim().max(2048).optional() });
const emptySchema = z.object({});

export default function LotsPage({route}:{route:import("@/lib/ledger/route-input").LedgerRouteInput}) {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <Lots route={route}/>
    </Suspense>
  );
}

function Lots({route}:{route:import("@/lib/ledger/route-input").LedgerRouteInput}) {
  const { can } = useWorkspaceAccess();
  const {user:actor}=useSession();
  const readable=can("trace.read")||!!actor&&["SYSTEM_ADMIN","AUDITOR","PLATFORM_OPERATOR","PLATFORM_CASE_MANAGER"].includes(actor.role.code);
  const params = useSearchParams();
  const router = useRouter();

  const [tab, setTab] = useState<"lots" | "shipments">("lots");
  const [state, setState] = useState("");
  const lots = useQuery({ queryKey: ["ws-lots"], queryFn: opsApi.lots, enabled: readable });
  const shipments = useQuery({ queryKey: ["ws-shipments"], queryFn: opsApi.shipments, enabled: can("distribution.read") && tab === "shipments" });
  const openId = typeof route.params.lotId==="string"?route.params.lotId:params.get("id");
  const setOpen = (id: string | null) => router.push(id?`/lots/${id}`:"/lots");
  if (!readable) return <ErrorState error={new Error(tr("Bạn chưa có quyền trace.read"))} />;
  const rows = lots.data?.filter((l) => !state || l.currentState === state);
  const cols: Column<InternalLot>[] = [
    { key: "code", header: tr("Lô"), sort: (l) => l.lotCode, cell: (l) => <span className="flex flex-col"><span className="font-mono text-[12.5px] font-medium">{l.lotCode}</span><span className="text-[12px] text-ink-2">{l.lotName ?? l.productName}</span></span> },
    { key: "product", header: tr("Sản phẩm"), hideBelow: "md", cell: (l) => <span className="text-[12.5px]">{l.productName}</span> },
    { key: "qty", header: tr("Còn / ban đầu"), sort: (l) => l.availableQuantity, cell: (l) => <span className="font-mono text-[12px]">{fmtNumber(l.availableQuantity)} / {fmtNumber(l.initialQuantity)} {l.unit}</span> },
    { key: "holder", header: tr("Đang giữ"), hideBelow: "lg", cell: (l) => <span className="text-[12.5px]">{l.custodian ? ROLE_LABEL_BUSINESS[l.custodian.role] : "—"}</span> },
    { key: "state", header: tr("Trạng thái"), cell: (l) => <Badge tone={LOT_STATE_TONE[l.currentState] ?? "neutral"}>{LOT_STATE_LABEL[l.currentState] ?? l.currentState}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (l) => <Button size="xs" variant={l.allowedCommands.length ? "default" : "outline"} onClick={() => setOpen(l.lotId)}>{l.allowedCommands.length ? tr("Xử lý") : tr("Chi tiết")}</Button> },
  ];
  const shipCols: Column<Shipment>[] = [
    { key: "lot", header: tr("Lô"), cell: (s) => <button type="button" className="flex flex-col text-left" onClick={() => setOpen(s.lotId)}><span className="font-mono text-[12.5px] font-medium hover:underline">{s.lot?.lotCode}</span><span className="text-[12px] text-ink-2">{s.lot?.product.productName}</span></button> },
    { key: "route", header: tr("Tuyến"), hideBelow: "md", cell: (s) => <span className="text-[12.5px]">{s.origin} → {s.destination}</span> },
    { key: "parties", header: tr("Vận chuyển → bán lẻ"), hideBelow: "lg", cell: (s) => <span className="text-[12.5px]">{s.transporter?.name} → {s.retailer?.name}</span> },
    { key: "qty", header: tr("Số lượng"), cell: (s) => <span className="font-mono text-[12px]">{fmtNumber(s.shippedQuantity)} {s.unit}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (s) => <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge> },
  ];
  return (
    <>
      <PageHeader title={tr("Lô hàng")} description={tr("Lô sinh ra từ thu hoạch và đi theo chuyến hàng tới bán lẻ. Mỗi lô chỉ hiện các lệnh mà tổ chức của bạn đang được phép làm, theo bên đang giữ hàng và trạng thái chuyến; mọi thay đổi số lượng được ghi thành biến động và lên sổ truy xuất.")} />
      <PageBody>
        <HarvestRecoveryPanel/>
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" className="flex gap-1">
            {(["lots", "shipments"] as const).map((k) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
                {k === "lots" ? tr("Lô hàng") : tr("Chuyến hàng")}
              </button>
            ))}
          </div>
          {tab === "lots" && <FilterSelect label={tr("Trạng thái")} value={state} onChange={setState} options={Object.keys(LOT_STATE_TONE).map((v) => ({ value: v, label: LOT_STATE_LABEL[v] }))} />}
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          {tab === "lots" ? (
            <DataTable rows={rows} loading={lots.isLoading} error={lots.error} onRetry={() => lots.refetch()} columns={cols} rowKey={(l) => l.lotId} empty={<EmptyState title={tr("Chưa có lô hàng")} />} />
          ) : (
            <DataTable rows={shipments.data} loading={shipments.isLoading} error={shipments.error} onRetry={() => shipments.refetch()} columns={shipCols} rowKey={(s) => s.id} empty={<EmptyState title={tr("Chưa có chuyến hàng")} />} />
          )}
        </div>
      </PageBody>
      <LotSheet id={openId} onClose={() => setOpen(null)} />
    </>
  );
}

function LotSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { user } = useSession();
  const now = useNow();
  const q = useQuery({ queryKey: ["ws-lot", id], queryFn: () => opsApi.lot(id!), enabled: !!id });
  const orgs = useQuery({ queryKey: ["organizations"], queryFn: opsApi.organizations, enabled: !!id });
  const cmd = useDialog<LotCommand>();
  const l = q.data;
  const s = l?.shipment;
  const invalidate = [["ws-lot", id], ["ws-lots"], ["ws-shipments"], ["ws-cycle"]];
  const nowLocal = isoToLocal(new Date(now).toISOString());
  const orgName = (oid?: string) => orgs.data?.find((o) => o.id === oid)?.name ?? oid?.slice(0, 8) ?? "—";
  const lv = l ? { version: l.version, shipmentVersion: s?.version } : { version: 0 };
  const sv = l && s ? { version: s.version, lotVersion: l.version } : { version: 0, lotVersion: 0 };
  const isFarm = !!l && l.farmOrg.organizationId === user?.organizationId;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!l ? (
          q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{l.lotCode}</SheetTitle>
              <SheetDescription>
                {l.lotName ? `${l.lotName} · ` : ""}{l.productName} · v{l.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={LOT_STATE_TONE[l.currentState] ?? "neutral"}>{LOT_STATE_LABEL[l.currentState] ?? l.currentState}</Badge>
                <Badge tone={l.proofStatus === "VERIFIED" ? "ok" : "info"} dot={false}>{l.proofStatus === "VERIFIED" ? tr("Đã xác nhận trên sổ cái") : l.proofStatus==="PENDING"?tr("Đang chờ xác nhận sổ cái"):l.proofStatus==="INTEGRITY_WARNING"?tr("Cảnh báo tính toàn vẹn"):tr("Sổ cái chưa khả dụng")}</Badge>
                {l.custodian && <Badge tone="neutral" dot={false}>{tr("Đang giữ")}: {orgName(l.custodian.organizationId)}</Badge>}
              </div>
              {l.warnings.map((warning,i)=><Callout key={i} tone="warn">{warning}</Callout>)}
              {l.isExpired&&<Callout tone="danger">{tr("Lô đã hết hạn sử dụng")}</Callout>}
              {(!l.quantityReconciled||!l.stateReconciled||l.proofStatus==="INTEGRITY_WARNING")&&<Callout tone="danger">{tr("Lô cần đối soát tính toàn vẹn")}</Callout>}
              {s?.handoverMode==="DUAL_SIGNED"&&l.chainId&&<LotHandovers lot={l}/>}
              {l.allowedCommands.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {l.allowedCommands.map((c) => (
                    <Button key={c} size="sm" variant={["recall", "reportDamage", "rejectRetail", "expire"].includes(c) ? "outline" : "default"} onClick={() => cmd.open(c)}>
                      {COMMAND_LABEL[c]}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px] text-ink-2">{tr("Tổ chức của bạn không có lệnh nào trên lô ở trạng thái này.")}</p>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Số lượng còn"), `${fmtNumber(l.availableQuantity)} / ${fmtNumber(l.initialQuantity)} ${l.unit}`],
                  [tr("Hư hỏng"), l.damagedQuantity ? `${fmtNumber(l.damagedQuantity)} ${l.unit}` : null],
                  [tr("Thu hoạch lúc"), fmtDateTime(l.harvestTime)],
                  [tr("Phân loại"), l.grade],
                  [tr("Đóng gói"), [l.packageCount && `${l.packageCount} ${tr("kiện")}`, l.packaging, l.packedAt && fmtDate(l.packedAt)].filter(Boolean).join(" · ")],
                  [tr("Hạn sử dụng"), l.expiryDate && fmtDate(l.expiryDate)],
                  [tr("Vụ sản xuất"), l.productionCycle?.cycleCode],
                  [tr("Tổ chức sản xuất"), l.farmOrg.name],
                  [tr("Mã truy xuất"), l.traceToken && <span key="trace-token" className="font-mono text-[12px]">{l.traceToken}</span>],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              {s && (
                <section className="flex flex-col gap-2 rounded-md border border-line px-3 py-3">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-semibold">{tr("Chuyến hàng")}</h3>
                    <Badge tone={SHIPMENT_STATUS_TONE[s.status]}>{SHIPMENT_STATUS_LABEL[s.status]}</Badge>
                    <span className="ml-auto font-mono text-[11px] text-ink-2">v{s.version}</span>
                  </div>
                  <p className="text-[13px]">{s.origin} → {s.destination}</p>
                  <p className="text-[12.5px] text-ink-2">{orgName(s.transporterOrgId)} → {orgName(s.retailerOrgId)} · {fmtNumber(s.shippedQuantity)} {l.unit}{s.receivedQuantity !== null ? ` · ${tr("nhận")} ${fmtNumber(s.receivedQuantity)}` : ""}</p>
                </section>
              )}
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Biến động số lượng")}</h3>
                {l.quantityMovements.length ? (
                  <table className="w-full text-[12.5px]">
                    <thead className="text-left text-ink-2">
                      <tr>
                        <th className="py-1 font-medium">{tr("Loại")}</th>
                        <th className="py-1 text-right font-medium">{tr("Trước")}</th>
                        <th className="py-1 text-right font-medium">{tr("Thay đổi")}</th>
                        <th className="py-1 text-right font-medium">{tr("Sau")}</th>
                        <th className="hidden py-1 text-right font-medium sm:table-cell">{tr("Thời điểm")}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {l.quantityMovements.map((m) => (
                        <tr key={m.id} className="border-t border-line/70">
                          <td className="py-1 font-sans">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                          <td className="py-1 text-right">{fmtNumber(m.beforeQty)}</td>
                          <td className={cn("py-1 text-right", m.delta < 0 ? "text-danger" : "text-ok")}>{m.delta > 0 ? "+" : ""}{fmtNumber(m.delta)}</td>
                          <td className="py-1 text-right">{fmtNumber(m.afterQty)}</td>
                          <td className="hidden py-1 text-right text-ink-2 sm:table-cell">{fmtDateTime(m.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <EmptyState title={tr("Chưa có biến động")} />
                )}
              </section>
              {l.traceToken&&<LotQr token={l.traceToken}/>}
              <section className="flex flex-col gap-2"><h3 className="text-[13px] font-semibold">{tr("Bằng chứng cảm biến")}</h3><Badge tone={l.sensorEvidence.status==="INTEGRITY_WARNING"?"danger":"neutral"}>{l.sensorEvidence.status}</Badge><p className="text-sm">{fmtDateTime(l.sensorEvidence.periodStart)} → {fmtDateTime(l.sensorEvidence.periodEnd)} · {l.sensorEvidence.readingCount} {tr("bản ghi")} · {l.sensorEvidence.lateReadingCount} {tr("bản ghi đến muộn")}</p>{l.sensorEvidence.digestHash&&<p className="break-all font-mono text-xs">{l.sensorEvidence.digestHash}</p>}</section>
              {l.blockchainProof&&<section className="flex flex-col gap-2"><h3 className="text-[13px] font-semibold">{tr("Bằng chứng sổ cái")}</h3><p className="text-sm">{l.blockchainProof.network} · {l.blockchainProof.transactionStatus} · {fmtDateTime(l.blockchainProof.recordedAt)}</p><p className="break-all font-mono text-xs">{l.blockchainProof.txId}</p><p className="break-all font-mono text-xs">{l.blockchainProof.dataHash}</p></section>}
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Chuỗi chế biến")}</h3>
                <LineagePanel lotId={l.lotId} />
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Dòng thời gian truy xuất")}</h3>
                <ol className="flex flex-col gap-1.5 border-l-2 border-line pl-3">
                  {l.timeline.map((e) => (
                    <li key={e.eventId} className="text-[13px]">
                      <span className="font-medium">{e.summary}</span> <span className="text-ink-2">· {e.actor.organizationName} ({ROLE_LABEL_BUSINESS[e.actor.role] ?? e.actor.role})</span>
                      <span className="flex gap-2 font-mono text-[11px] text-ink-2">
                        {fmtDateTime(e.eventTime)} · {e.eventType} · {e.proofStatus === "VERIFIED" ? tr("đã xác nhận") : tr("chờ xác nhận")}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
              {isFarm && <EvidencePanel entityType="LOT" entityId={l.lotId} canManage={false} title={tr("Ảnh & chứng từ lô")} />}
            </div>

            {cmd.target === "createShipment" && (
              <CommandDialog
                {...cmd.props}
                title={tr("Tạo chuyến hàng · {p0}", { p0: l.lotCode })}
                endpoint="POST /shipments"
                description={tr("Chuyến chở toàn bộ lượng còn lại của lô. Đơn vị vận chuyển và bán lẻ phải là tổ chức đang hoạt động đúng loại. Lô chỉ có một chuyến hàng.")}
                schema={shipmentSchema}
                defaultValues={{ transporterOrgId: "", retailerOrgId: "", origin: "", destination: "", plannedPickupTime: "", expectedArrivalTime: "", vehicleRef: "" }}
                submitLabel={tr("Tạo chuyến")}
                invalidate={invalidate}
                wide
                run={(v, c) => opsApi.createShipment({ lotId: l.lotId, transporterOrgId: v.transporterOrgId, retailerOrgId: v.retailerOrgId, origin: v.origin, destination: v.destination, plannedPickupTime: localToIso(v.plannedPickupTime), expectedArrivalTime: localToIso(v.expectedArrivalTime), vehicleRef: v.vehicleRef || undefined }, c)}
              >
                {(f) => (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField control={f.control} name="transporterOrgId" label={tr("Đơn vị vận chuyển")} options={(orgs.data ?? []).filter((o) => o.type === "TRANSPORTER" && o.status === "ACTIVE").map((o) => ({ value: o.id, label: o.name }))} />
                    <SelectField control={f.control} name="retailerOrgId" label={tr("Đơn vị bán lẻ")} options={(orgs.data ?? []).filter((o) => o.type === "RETAILER" && o.status === "ACTIVE").map((o) => ({ value: o.id, label: o.name }))} />
                    <TextField control={f.control} name="origin" label={tr("Nơi lấy hàng")} />
                    <TextField control={f.control} name="destination" label={tr("Nơi giao")} />
                    <TextField control={f.control} name="plannedPickupTime" label={tr("Dự kiến lấy hàng")} type="datetime-local" />
                    <TextField control={f.control} name="expectedArrivalTime" label={tr("Dự kiến đến")} type="datetime-local" />
                    <TextField control={f.control} name="vehicleRef" label={tr("Phương tiện")} />
                  </div>
                )}
              </CommandDialog>
            )}
            {(cmd.target === "startTransport" || cmd.target === "reportArrival") && s && (
              <CommandDialog {...cmd.props} title={`${COMMAND_LABEL[cmd.target]} · ${l.lotCode}`} endpoint={cmd.target === "startTransport" ? "POST /shipments/:id/start" : "POST /shipments/:id/arrive"} description={tr("Thời điểm không được ở tương lai và không trước mốc bàn giao trước đó.")} schema={timeSchema} defaultValues={{ occurredAt: nowLocal }} submitLabel={COMMAND_LABEL[cmd.target]} invalidate={invalidate} run={(v, c) => (cmd.target === "startTransport" ? opsApi.startShipment : opsApi.arriveShipment)(s.shipmentId, { ...sv, occurredAt: localToIso(v.occurredAt) }, c)}>
                {(f) => <TextField control={f.control} name="occurredAt" label={tr("Thời điểm")} type="datetime-local" />}
              </CommandDialog>
            )}
            {cmd.target === "receiveRetail" && s && (
              <CommandDialog
                {...cmd.props}
                title={tr("Nhận hàng · {p0}", { p0: l.lotCode })}
                endpoint="POST /shipments/:id/receive"
                description={tr("Số lượng nhận + hư hỏng phải bằng đúng lượng còn lại của lô ({p0} {p1}).", { p0: fmtNumber(l.availableQuantity), p1: l.unit })}
                schema={z.object({ receivedQuantity: qty, damagedQuantity: z.union([z.literal(""), z.coerce.number<number>().min(0)]).optional(), note: z.string().max(2000).optional(), occurredAt: z.string().min(1) }).refine((v) => Math.round((v.receivedQuantity + Number(v.damagedQuantity || 0)) * 1000) === Math.round(Number(l.availableQuantity) * 1000), { path: ["receivedQuantity"], error: () => tr("Nhận + hư hỏng phải bằng lượng còn lại") })}
                defaultValues={{ receivedQuantity: l.availableQuantity, damagedQuantity: "", note: "", occurredAt: nowLocal }}
                submitLabel={tr("Nhận hàng")}
                invalidate={invalidate}
                run={(v, c) => opsApi.receiveShipment(s.shipmentId, { ...sv, receivedQuantity: v.receivedQuantity, damagedQuantity: v.damagedQuantity === "" || v.damagedQuantity === undefined ? undefined : Number(v.damagedQuantity), note: v.note || undefined, occurredAt: localToIso(v.occurredAt) }, c)}
              >
                {(f) => (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField control={f.control} name="receivedQuantity" label={tr("Số lượng nhận")} type="number" />
                      <TextField control={f.control} name="damagedQuantity" label={tr("Hư hỏng")} type="number" />
                      <TextField control={f.control} name="occurredAt" label={tr("Thời điểm nhận")} type="datetime-local" />
                    </div>
                    <TextAreaField control={f.control} name="note" label={tr("Ghi chú")} />
                  </>
                )}
              </CommandDialog>
            )}
            {cmd.target === "rejectRetail" && s && (
              <CommandDialog {...cmd.props} title={tr("Từ chối nhận · {p0}", { p0: l.lotCode })} endpoint="POST /shipments/:id/reject" description={tr("Toàn bộ lượng còn lại bị từ chối; lô chuyển sang trạng thái bị từ chối nhận.")} schema={reasonSchema} defaultValues={{ reason: "" }} tone="danger" submitLabel={tr("Từ chối nhận")} invalidate={invalidate} run={(v, c) => opsApi.rejectShipment(s.shipmentId, { ...sv, reason: v.reason }, c)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
              </CommandDialog>
            )}
            {cmd.target === "reportDamage" && (
              <CommandDialog
                {...cmd.props}
                title={tr("Ghi hư hỏng · {p0}", { p0: l.lotCode })}
                endpoint={s ? "POST /shipments/:id/damage" : "POST /lots/:lotId/damage"}
                description={s ? tr("Bên đang giữ hàng ghi hư hỏng trong chuyến; hư hỏng toàn bộ làm chuyến thất bại.") : tr("Nơi sản xuất chỉ ghi hư hỏng khi lô còn tại vườn và chưa có chuyến hàng.")}
                schema={damageSchema}
                defaultValues={{ quantity: "" as unknown as number, reason: "", evidenceRef: "" }}
                tone="danger"
                submitLabel={tr("Ghi hư hỏng")}
                invalidate={invalidate}
                run={(v, c) => (s ? opsApi.damageShipment(s.shipmentId, { ...sv, quantity: v.quantity, reason: v.reason, evidenceRef: v.evidenceRef || undefined }, c) : opsApi.damage(l.lotId, { ...lv, quantity: v.quantity, reason: v.reason, evidenceRef: v.evidenceRef || undefined }, c))}
              >
                {(f) => (
                  <>
                    <TextField control={f.control} name="quantity" label={tr("Lượng hư hỏng ({p0}, tối đa {p1})", { p0: l.unit, p1: fmtNumber(l.availableQuantity) })} type="number" />
                    <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
                    <TextField control={f.control} name="evidenceRef" label={tr("Tham chiếu chứng cứ")} />
                  </>
                )}
              </CommandDialog>
            )}
            {(cmd.target === "markForSale" || cmd.target === "markSold") && (
              <CommandDialog {...cmd.props} title={`${COMMAND_LABEL[cmd.target]} · ${l.lotCode}`} endpoint={cmd.target === "markForSale" ? "POST /lots/:lotId/mark-for-sale" : "POST /lots/:lotId/mark-sold"} description={cmd.target === "markSold" ? tr("Ghi đã bán đưa lượng còn lại về 0.") : tr("Chỉ bày bán lô đã nhận và còn hạn sử dụng.")} schema={emptySchema} defaultValues={{}} submitLabel={COMMAND_LABEL[cmd.target]} invalidate={invalidate} run={(_, c) => (cmd.target === "markForSale" ? opsApi.markForSale : opsApi.markSold)(l.lotId, lv, c)}>
                {() => null}
              </CommandDialog>
            )}
            {(cmd.target === "recall" || cmd.target === "expire") && (
              <CommandDialog {...cmd.props} title={`${COMMAND_LABEL[cmd.target]} · ${l.lotCode}`} endpoint={cmd.target === "recall" ? "POST /lots/:lotId/recall" : "POST /lots/:lotId/expire"} description={cmd.target === "recall" ? tr("Bên đang giữ hàng thu hồi lô; lượng còn về 0 và chuyến hàng đang dở (nếu có) chuyển thất bại.") : tr("Chỉ ghi khi lô đã quá hạn sử dụng.")} schema={reasonSchema} defaultValues={{ reason: "" }} tone="danger" submitLabel={COMMAND_LABEL[cmd.target]} invalidate={invalidate} run={(v, c) => (cmd.target === "recall" ? opsApi.recall : opsApi.expire)(l.lotId, { ...lv, reason: v.reason }, c)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LotQr({token}:{token:string}){const path=getTracePath(token),url=path?publicTraceUrl(token,typeof window==="undefined"?"":window.location.origin):"",matrix=useMemo(()=>url?createQrMatrix(url):[],[url]),d=createQrSvgPath(matrix),n=matrix.length+8;const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}"><rect width="100%" height="100%" fill="white"/><path d="${d}" transform="translate(4 4)" fill="black"/></svg>`;if(!path)return null;return <section className="flex flex-col items-start gap-2"><h3 className="text-sm font-semibold">{tr("Mã QR truy xuất")}</h3><svg role="img" aria-label={tr("Mã QR truy xuất")} viewBox={`0 0 ${n} ${n}`} className="size-36 bg-white"><path fill="black" d={d} transform="translate(4 4)"/></svg><a href={url} className="break-all text-sm text-brand underline">{url}</a><Button size="sm" variant="outline" onClick={()=>{const blob=new Blob([svg],{type:"image/svg+xml"}),local=URL.createObjectURL(blob),a=document.createElement("a");a.href=local;a.download="agritrace-qr.svg";a.click();setTimeout(()=>URL.revokeObjectURL(local),1000);}}>{tr("Tải QR")}</Button></section>;}
