"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { z } from "zod";
import { distApi } from "@/lib/ledger/dist-api";
import type { QuarantineCaseView, SiteTransferView, StockLot } from "@/lib/ledger/dist-types";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";
import {EvidencePanel} from "@/components/ledger/workspace/evidence-panel";

const SLIP_LABEL: Record<SiteTransferView["status"], string> = localized({ PENDING: "Chờ xuất", IN_TRANSIT: "Đang chuyển", RECEIVED: "Đã nhận", DISCREPANCY: "Chênh lệch", CANCELLED: "Đã hủy" });
const SLIP_TONE: Record<SiteTransferView["status"], "info" | "brand" | "ok" | "warn" | "neutral"> = { PENDING: "info", IN_TRANSIT: "brand", RECEIVED: "ok", DISCREPANCY: "warn", CANCELLED: "neutral" };
const CAUSE_LABEL: Record<QuarantineCaseView["cause"], string> = localized({ SUSPECTED_DAMAGE: "Nghi hư hỏng", QUALITY_FAILED: "Không đạt chất lượng", AWAITING_INSPECTION: "Chờ kiểm định", OTHER: "Lý do khác" });
const CASE_LABEL: Record<QuarantineCaseView["status"], string> = localized({ ACTIVE: "Đang cách ly", RELEASED: "Đã giải tỏa", DISPOSED: "Đã xử lý hủy" });
const DEC = /^\d{1,11}(\.\d{1,3})?$/;
const qty = z.string().regex(DEC, { error: () => tr("Số không âm, tối đa 3 chữ số thập phân") }).refine((v) => Number(v) > 0, { error: () => tr("Phải lớn hơn 0") });
const reason = (min: number) => z.string().trim().min(min, { error: () => tr("Tối thiểu {p0} ký tự", { p0: min }) }).max(1000);
const INVALIDATE = [["dist-report"], ["dist-slips"], ["dist-cases"], ["dist-tasks"], ["ws-lots"]];

type LotAction = "ALLOCATE" | "HOLD" | "TRANSFER" | "SALE" | "DAMAGE" | "NOTICE";
type SlipAction = { slip: SiteTransferView; kind: "DISPATCH" | "RECEIVE" | "RESOLVE" | "CANCEL" };
type CaseAction = { c: QuarantineCaseView; kind: "RELEASE" | "DISPOSE" };

export default function InventoryPage() {
  const { can } = useWorkspaceAccess();
  const [tab, setTab] = useState<"stock" | "slips" | "cases">("stock");
  const [siteId, setSiteId] = useState("");
  const [q, setQ] = useState("");
  const [openLot, setOpenLot] = useState<string | null>(null);
  const report = useQuery({ queryKey: ["dist-report", siteId, q], queryFn: () => distApi.report({ siteId: siteId || undefined, q: q.trim() || undefined }), enabled: can("reports.read") });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("reports.read") });
  if (!can("reports.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền reports.read"))} />;
  const ownSites = (sites.data ?? []).filter((s) => s.status === "ACTIVE");
  const lot = report.data?.lots.find((l) => l.lotId === openLot) ?? null;
  const cols: Column<StockLot>[] = [
    { key: "lot", header: tr("Lô"), cell: (l) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{l.lotCode}</span><span className="text-[12px] text-ink-2">{l.productName}</span></span> },
    { key: "held", header: tr("Đang giữ"), cell: (l) => <span className="font-mono text-[12.5px]">{fmtNumber(l.held)} {l.unit}</span> },
    { key: "available", header: tr("Khả dụng"), cell: (l) => <span className="font-mono text-[12.5px]">{fmtNumber(l.available)}</span> },
    { key: "reserved", header: tr("Giữ chỗ / cách ly"), hideBelow: "md", cell: (l) => <span className="font-mono text-[12px] text-ink-2">{fmtNumber(l.reserved)} / {fmtNumber(l.quarantined)}</span> },
    { key: "sites", header: tr("Theo cơ sở"), hideBelow: "lg", cell: (l) => <span className="text-[12px]">{l.siteHoldings.length ? l.siteHoldings.map((s) => `${s.siteName}: ${fmtNumber(s.quantity)}`).join(" · ") : "—"}</span> },
    { key: "flags", header: tr("Lưu ý"), hideBelow: "md", cell: (l) => (
      <span className="flex flex-wrap gap-1">
        {l.notices.map((n, i) => <Badge key={i} tone={n.kind === "RECALL" ? "danger" : "warn"} dot={false}>{n.kind === "RECALL" ? tr("Thu hồi") : tr("Cảnh báo")}</Badge>)}
        {l.blocked && <Badge tone="danger" dot={false}>{tr("Bị chặn")}</Badge>}
        {l.expiryDate && <span className="font-mono text-[11.5px] text-ink-2">HSD {fmtDate(l.expiryDate)}</span>}
      </span>
    ) },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (l) => <Button size="xs" variant="outline" onClick={() => setOpenLot(l.lotId)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <>
      <PageHeader title={tr("Tồn kho")} description={tr("Lượng doanh nghiệp đang giữ theo lô và theo cơ sở, gồm lô vừa thu hoạch chưa giao đi và hàng đã nhận. Phân bổ vào cơ sở, chuyển kho nội bộ, cách ly, ghi bán hoặc hư hỏng đều cập nhật phiên bản lô và ghi sự kiện truy xuất.")} />
      <PageBody>
        <div role="tablist" className="flex flex-wrap gap-1">
          {(["stock", "slips", "cases"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {{ stock: tr("Tồn theo lô"), slips: tr("Phiếu chuyển kho"), cases: tr("Phiếu cách ly") }[k]}
            </button>
          ))}
        </div>
        {tab === "stock" && (
          <>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inv-q" className="text-[13px] font-medium">{tr("Tìm lô")}</label>
                <Input id="inv-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Mã lô hoặc sản phẩm")} className="w-[240px]" />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inv-site" className="text-[13px] font-medium">{tr("Cơ sở")}</label>
                <select id="inv-site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="h-9 rounded-md border border-input bg-transparent px-2 text-[13px]">
                  <option value="">{tr("Tất cả cơ sở")}</option>
                  {ownSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-line bg-card">
              <DataTable rows={report.data?.lots} loading={report.isLoading} error={report.error} onRetry={() => report.refetch()} columns={cols} rowKey={(l) => l.lotId} empty={<EmptyState title={tr("Không có lô đang giữ")} />} />
            </div>
          </>
        )}
        {tab === "slips" && <Slips />}
        {tab === "cases" && <Cases lots={report.data?.lots ?? []} />}
      </PageBody>
      <LotSheet lot={lot} ownSites={ownSites} onClose={() => setOpenLot(null)} />
    </>
  );
}

// ---------------------------------------------------------------------------
function LotSheet({ lot, ownSites, onClose }: { lot: StockLot | null; ownSites: { id: string; name: string }[]; onClose: () => void }) {
  const { user } = useSession();
  const { can, primary } = useWorkspaceAccess();
  const act = useDialog<LotAction>();
  const members=useQuery({queryKey:["ws-members"],queryFn:wapi.members,enabled:can("inventory.manage")&&can("members.read")});
  if (!lot) return <Sheet open={false} />;
  const held = lot.siteHoldings.filter((s) => Number(s.quantity) > 0);
  const siteOpts = held.map((s) => ({ value: s.siteId, label: `${s.siteName} · ${tr("khả dụng")} ${fmtNumber(s.available)}` }));
  const base = { lotId: lot.lotId, unit: lot.unit, version: lot.version };
  const actions: { k: LotAction; label: string; show: boolean }[] = [
    { k: "ALLOCATE", label: tr("Phân bổ vào cơ sở"), show: primary && can("inventory.manage") && Number(lot.unallocated ?? 0) > 0 },
    { k: "TRANSFER", label: tr("Lập phiếu chuyển kho"), show: can("inventory.manage") && held.length > 0 && ownSites.length > 1 },
    { k: "HOLD", label: tr("Cách ly"), show: can("quarantine.manage") && held.length > 0 },
    { k: "SALE", label: tr("Ghi bán"), show: can("quantity.adjust") && !lot.blocked },
    { k: "DAMAGE", label: tr("Ghi hư hỏng"), show: can("quantity.adjust") },
    { k: "NOTICE", label: tr("Phát cảnh báo / thu hồi"), show: can("distribution.write") && lot.farmOrgId === user?.organizationId },
  ];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{lot.lotCode}</SheetTitle>
          <SheetDescription>{lot.productName}{lot.chainName ? ` · ${lot.chainName}` : ""} · v{lot.version}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          {lot.notices.map((n, i) => <Callout key={i} tone={n.kind === "RECALL" ? "danger" : "warn"}>{n.message}</Callout>)}
          <div className="flex flex-wrap gap-2">
            {actions.filter((a) => a.show).map((a) => <Button key={a.k} size="sm" variant={a.k === "NOTICE" || a.k === "DAMAGE" ? "outline" : "default"} onClick={() => act.open(a.k)}>{a.label}</Button>)}
          </div>
          <dl className="grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-ink-2">{tr("Đang giữ")}</dt><dd className="font-mono">{fmtNumber(lot.held)} {lot.unit}</dd>
            <dt className="text-ink-2">{tr("Giữ chỗ cho giao nhận")}</dt><dd className="font-mono">{fmtNumber(lot.reserved)}</dd>
            <dt className="text-ink-2">{tr("Đang cách ly")}</dt><dd className="font-mono">{fmtNumber(lot.quarantined)}</dd>
            <dt className="text-ink-2">{tr("Khả dụng")}</dt><dd className="font-mono">{fmtNumber(lot.available)}</dd>
            {lot.unallocated !== null && (<><dt className="text-ink-2">{tr("Chưa phân bổ cơ sở")}</dt><dd className="font-mono">{fmtNumber(lot.unallocated)}</dd></>)}
            {lot.internalInTransit !== null && Number(lot.internalInTransit) > 0 && (<><dt className="text-ink-2">{tr("Đang chuyển kho")}</dt><dd className="font-mono">{fmtNumber(lot.internalInTransit)}</dd></>)}
            <dt className="text-ink-2">{tr("Hạn sử dụng")}</dt><dd>{lot.expiryDate ? fmtDate(lot.expiryDate) : "—"}</dd>
          </dl>
          <section className="flex flex-col gap-2">
            <h3 className="text-[13px] font-semibold">{tr("Theo cơ sở")}</h3>
            {held.length ? (
              <ul className="divide-y divide-line/70 rounded-md border border-line">
                {lot.siteHoldings.map((s) => (
                  <li key={s.siteId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1">{s.siteName}</span>
                    <span className="font-mono text-[12px]">{tr("tồn {p0} · giữ chỗ {p1} · cách ly {p2} · khả dụng {p3}", { p0: fmtNumber(s.quantity), p1: fmtNumber(s.reserved), p2: fmtNumber(s.quarantined), p3: fmtNumber(s.available) })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-ink-2">{tr("Chưa phân bổ vào cơ sở nào.")}</p>
            )}
          </section>
        </div>

        {act.target === "ALLOCATE" && (
          <CommandDialog {...act.props} title={tr("Phân bổ vào cơ sở")} endpoint="POST /distribution/allocations" description={tr("Đưa phần chưa xác định cơ sở vào một cơ sở đang hoạt động. Chuyển giữa hai cơ sở thì dùng phiếu chuyển kho.")} schema={z.object({ siteId: z.string().min(1, { error: () => tr("Chọn cơ sở") }), quantity: qty, reason: reason(10) })} defaultValues={{ siteId: "", quantity: lot.unallocated ?? "", reason: "" }} version={lot.version} submitLabel={tr("Phân bổ")} invalidate={INVALIDATE} run={(v, cmd) => distApi.allocate({ ...base, ...v }, cmd)}>
            {(f) => (
              <>
                <SelectField control={f.control} name="siteId" label={tr("Cơ sở")} options={ownSites.map((s) => ({ value: s.id, label: s.name }))} />
                <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: lot.unit })} inputMode="decimal" />
                <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
              </>
            )}
          </CommandDialog>
        )}
        {act.target === "TRANSFER" && (
          <CommandDialog {...act.props} title={tr("Lập phiếu chuyển kho")} endpoint="POST /distribution/site-transfers" description={tr("Hàng rời cơ sở xuất khi xuất phiếu và chỉ vào cơ sở nhận khi xác nhận thực nhận; phần thiếu được trả về hoặc ghi hư hỏng.")} schema={z.object({ fromSiteId: z.string().min(1, { error: () => tr("Chọn cơ sở xuất") }), toSiteId: z.string().min(1, { error: () => tr("Chọn cơ sở nhận") }), quantity: qty, reason: reason(10), receiverUserId:z.union([z.literal("__none"),z.uuid()]), note:z.string().max(1000), dispatch: z.enum(["no", "yes"]) }).refine((v) => v.fromSiteId !== v.toSiteId, { path: ["toSiteId"], error: () => tr("Cơ sở xuất và cơ sở nhận phải khác nhau") })} defaultValues={{ fromSiteId: held[0]?.siteId ?? "", toSiteId: "", quantity: "", reason: "", receiverUserId:"__none",note:"", dispatch: "no" }} version={lot.version} submitLabel={tr("Lập phiếu")} invalidate={INVALIDATE} run={(v, cmd) => distApi.createSiteTransfer({ ...base, fromSiteId: v.fromSiteId, toSiteId: v.toSiteId, quantity: v.quantity, reason: v.reason, receiverUserId:v.receiverUserId==="__none"?undefined:v.receiverUserId,note:v.note||undefined,dispatch: v.dispatch === "yes" }, cmd)}>
            {(f) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField control={f.control} name="fromSiteId" label={tr("Cơ sở xuất")} options={siteOpts} />
                  <SelectField control={f.control} name="toSiteId" label={tr("Cơ sở nhận")} options={ownSites.map((s) => ({ value: s.id, label: s.name }))} />
                  <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: lot.unit })} inputMode="decimal" />
                  <SelectField control={f.control} name="receiverUserId" label={tr("Người nhận dự kiến")} options={[{value:"__none",label:tr("Không chỉ định")},...(members.data??[]).filter(m=>m.accountStatus==="ACTIVE").map(m=>({value:m.id,label:m.fullName}))]}/>
                  <SelectField control={f.control} name="dispatch" label={tr("Xuất hàng")} options={[{ value: "no", label: tr("Để chờ xuất") }, { value: "yes", label: tr("Xuất ngay") }]} />
                </div>
                <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
                <TextAreaField control={f.control} name="note" label={tr("Ghi chú chuyển kho")} max={1000}/>
              </>
            )}
          </CommandDialog>
        )}
        {act.target === "HOLD" && (
          <CommandDialog {...act.props} title={tr("Cách ly hàng tại cơ sở")} endpoint="POST /distribution/quarantine" description={tr("Tạo phiếu cách ly; lượng cách ly không được giao, bán hay chuyển cho tới khi giải tỏa hoặc ghi hư hỏng.")} schema={z.object({ siteId: z.string().min(1, { error: () => tr("Chọn cơ sở") }), quantity: qty, cause: z.enum(["SUSPECTED_DAMAGE", "QUALITY_FAILED", "AWAITING_INSPECTION", "OTHER"]), reason: reason(10), note: z.string().max(1000).optional() })} defaultValues={{ siteId: held[0]?.siteId ?? "", quantity: "", cause: "SUSPECTED_DAMAGE", reason: "", note: "" }} version={lot.version} tone="danger" submitLabel={tr("Cách ly")} invalidate={INVALIDATE} run={(v, cmd) => distApi.quarantine({ ...base, ...v, action: "HOLD", note: v.note || undefined }, cmd)}>
            {(f) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField control={f.control} name="siteId" label={tr("Cơ sở")} options={siteOpts} />
                  <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: lot.unit })} inputMode="decimal" />
                </div>
                <SelectField control={f.control} name="cause" label={tr("Nguyên nhân")} options={Object.entries(CAUSE_LABEL).map(([value, label]) => ({ value, label }))} />
                <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
                <TextAreaField control={f.control} name="note" label={tr("Ghi chú")} max={1000} />
              </>
            )}
          </CommandDialog>
        )}
        {(act.target === "SALE" || act.target === "DAMAGE") && (
          <CommandDialog {...act.props} title={act.target === "SALE" ? tr("Ghi bán") : tr("Ghi hư hỏng")} endpoint="POST /distribution/quantities" description={act.target === "SALE" ? tr("Chỉ doanh nghiệp bán lẻ được ghi bán; dừng ghi bán khi lô hết hạn hoặc có thông báo thu hồi.") : tr("Ghi giảm lượng hư hỏng tại cơ sở; không chọn cơ sở thì chỉ ghi được phần chưa phân bổ (tài khoản cấp 1).")} schema={z.object({ siteId: z.string(), quantity: qty, reason: reason(3) })} defaultValues={{ siteId: held[0]?.siteId ?? "", quantity: "", reason: "" }} version={lot.version} tone={act.target === "DAMAGE" ? "danger" : "default"} submitLabel={act.target === "SALE" ? tr("Ghi bán") : tr("Ghi hư hỏng")} invalidate={INVALIDATE} run={(v, cmd) => distApi.dispose({ ...base, kind: act.target as "SALE" | "DAMAGE", quantity: v.quantity, reason: v.reason, siteId: v.siteId || undefined }, cmd)}>
            {(f) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField control={f.control} name="siteId" label={tr("Cơ sở")} options={[...(primary ? [{ value: "", label: tr("Phần chưa phân bổ") }] : []), ...siteOpts]} />
                  <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: lot.unit })} inputMode="decimal" />
                </div>
                <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={500} />
              </>
            )}
          </CommandDialog>
        )}
        {act.target === "NOTICE" && (
          <CommandDialog {...act.props} title={tr("Phát cảnh báo / thu hồi")} endpoint="POST /distribution/notices" description={tr("Thông báo hiện trên trang truy xuất công khai và chặn giao nhận, ghi bán của mọi bên đang giữ lô (khi là thu hồi). Chỉ doanh nghiệp sản xuất lô nguồn được phát.")} schema={z.object({ kind: z.enum(["WARNING", "RECALL"]), message: z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(500) })} defaultValues={{ kind: "WARNING", message: "" }} tone="danger" submitLabel={tr("Phát thông báo")} invalidate={INVALIDATE} run={(v, cmd) => distApi.notice({ lotId: lot.lotId, ...v }, cmd)}>
            {(f) => (
              <>
                <SelectField control={f.control} name="kind" label={tr("Loại")} options={[{ value: "WARNING", label: tr("Cảnh báo") }, { value: "RECALL", label: tr("Thu hồi") }]} />
                <TextAreaField control={f.control} name="message" label={tr("Nội dung công khai")} max={500} />
              </>
            )}
          </CommandDialog>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function Slips() {
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["dist-slips"], queryFn: distApi.siteTransfers, enabled: can("inventory.manage") });
  const act = useDialog<SlipAction>();
  const evidence=useDialog<SiteTransferView>();
  if (!can("inventory.manage")) return <Callout tone="info">{tr("Cần quyền inventory.manage để xem phiếu chuyển kho.")}</Callout>;
  const t = act.target;
  const cols: Column<SiteTransferView>[] = [
    {key:"evidence",header:tr("Chứng cứ"),cell:r=>can("evidence.read")?<Button size="xs" variant="outline" onClick={()=>evidence.open(r)}>{tr("Chứng cứ")}</Button>:null},
    { key: "code", header: tr("Phiếu"), cell: (r) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{r.code}</span><span className="text-[12px] text-ink-2">{r.lotCode} · {r.productName}</span></span> },
    { key: "route", header: tr("Từ → đến"), hideBelow: "md", cell: (r) => <span className="text-[12.5px]">{r.fromSiteName} → {r.toSiteName}</span> },
    { key: "qty", header: tr("Số lượng"), cell: (r) => <span className="font-mono text-[12.5px]">{fmtNumber(r.quantity)} {r.unit}{r.shortfall && Number(r.shortfall) > 0 ? ` (${tr("thiếu")} ${fmtNumber(r.shortfall)})` : ""}</span> },
    { key: "at", header: tr("Lập lúc"), hideBelow: "lg", cell: (r) => <span className="font-mono text-[12px]">{fmtDateTime(r.createdAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (r) => <Badge tone={SLIP_TONE[r.status]}>{SLIP_LABEL[r.status]}{r.resolution ? ` · ${r.resolution === "RETURNED" ? tr("đã trả về") : tr("đã ghi hư hỏng")}` : ""}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (r) => (
      <span className="flex flex-wrap gap-1">
        {r.status === "PENDING" && <Button size="xs" onClick={() => act.open({ slip: r, kind: "DISPATCH" })}>{tr("Xuất hàng")}</Button>}
        {r.status === "PENDING" && <Button size="xs" variant="outline" onClick={() => act.open({ slip: r, kind: "CANCEL" })}>{tr("Hủy")}</Button>}
        {r.status === "IN_TRANSIT" && <Button size="xs" onClick={() => act.open({ slip: r, kind: "RECEIVE" })}>{tr("Xác nhận nhận")}</Button>}
        {r.status === "DISCREPANCY" && <Button size="xs" onClick={() => act.open({ slip: r, kind: "RESOLVE" })}>{tr("Xử lý chênh lệch")}</Button>}
      </span>
    ) },
  ];
  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(r) => r.id} empty={<EmptyState title={tr("Chưa có phiếu chuyển kho")}>{tr("Lập phiếu từ chi tiết lô ở tab Tồn theo lô.")}</EmptyState>} />
      </div>
      {evidence.target&&<InventoryEvidence entityType="SITE_TRANSFER" entityId={evidence.target.id} code={evidence.target.code} onClose={evidence.close} details={[[tr("Người nhận dự kiến"),evidence.target.receiverName],[tr("Ghi chú chuyển kho"),evidence.target.note],[tr("Ghi chú nhận hàng"),evidence.target.receiptNote]]}/>}
      {t?.kind === "DISPATCH" && (
        <CommandDialog {...act.props} title={tr("Xuất hàng phiếu {p0}", { p0: t.slip.code })} endpoint="POST /distribution/site-transfers/:id/dispatch" description={tr("Trừ {p0} {p1} khỏi {p2}.", { p0: fmtNumber(t.slip.quantity), p1: t.slip.unit, p2: t.slip.fromSiteName ?? "" })} schema={z.object({})} defaultValues={{}} version={t.slip.version} submitLabel={tr("Xuất hàng")} invalidate={INVALIDATE} run={(_, cmd) => distApi.dispatchSiteTransfer(t.slip.id, { version: t.slip.version }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
      {t?.kind === "CANCEL" && (
        <CommandDialog {...act.props} title={tr("Hủy phiếu {p0}", { p0: t.slip.code })} endpoint="POST /distribution/site-transfers/:id/cancel" schema={z.object({})} defaultValues={{}} version={t.slip.version} tone="danger" submitLabel={tr("Hủy phiếu")} invalidate={INVALIDATE} run={(_, cmd) => distApi.cancelSiteTransfer(t.slip.id, { version: t.slip.version }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
      {t?.kind === "RECEIVE" && (
        <CommandDialog {...act.props} title={tr("Xác nhận nhận phiếu {p0}", { p0: t.slip.code })} endpoint="POST /distribution/site-transfers/:id/receive" description={tr("Nhận ít hơn lượng chuyển thì phiếu chuyển sang Chênh lệch để xử lý phần thiếu.")} schema={z.object({ note:z.string().max(1000),receivedQuantity: z.string().regex(DEC, { error: () => tr("Số không âm, tối đa 3 chữ số thập phân") }).refine((v) => Number(v) <= Number(t.slip.quantity), { error: () => tr("Lượng thực nhận vượt lượng chuyển") }) })} defaultValues={{ receivedQuantity: t.slip.quantity,note:"" }} version={t.slip.version} submitLabel={tr("Xác nhận")} invalidate={INVALIDATE} run={(v, cmd) => distApi.receiveSiteTransfer(t.slip.id, { version: t.slip.version, receivedQuantity: v.receivedQuantity,note:v.note||undefined }, cmd)}>
          {(f) => <><TextField control={f.control} name="receivedQuantity" label={tr("Thực nhận ({p0})", { p0: t.slip.unit })} inputMode="decimal" /><TextAreaField control={f.control} name="note" label={tr("Ghi chú nhận hàng")} max={1000}/></>}
        </CommandDialog>
      )}
      {t?.kind === "RESOLVE" && (
        <CommandDialog {...act.props} title={tr("Xử lý chênh lệch {p0}", { p0: t.slip.code })} endpoint="POST /distribution/site-transfers/:id/resolve" description={tr("Phần thiếu {p0} {p1}: trả về cơ sở xuất hoặc ghi hư hỏng (cần quyền quantity.adjust).", { p0: fmtNumber(t.slip.shortfall), p1: t.slip.unit })} schema={z.object({ resolution: z.enum(["RETURNED", "WRITTEN_OFF"]), note: reason(10) })} defaultValues={{ resolution: "RETURNED", note: "" }} version={t.slip.version} submitLabel={tr("Xử lý")} invalidate={INVALIDATE} run={(v, cmd) => distApi.resolveSiteTransfer(t.slip.id, { version: t.slip.version, ...v }, cmd)}>
          {(f) => (
            <>
              <SelectField control={f.control} name="resolution" label={tr("Cách xử lý")} options={[{ value: "RETURNED", label: tr("Trả về cơ sở xuất") }, { value: "WRITTEN_OFF", label: tr("Ghi hư hỏng") }]} />
              <TextAreaField control={f.control} name="note" label={tr("Ghi chú")} max={1000} />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
function Cases({ lots }: { lots: StockLot[] }) {
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["dist-cases"], queryFn: distApi.quarantineCases, enabled: can("quarantine.manage") });
  const act = useDialog<CaseAction>();
  const evidence=useDialog<QuarantineCaseView>();
  if (!can("quarantine.manage")) return <Callout tone="info">{tr("Cần quyền quarantine.manage để xem phiếu cách ly.")}</Callout>;
  const t = act.target;
  const lotOf = (c: QuarantineCaseView) => lots.find((l) => l.lotId === c.lotId);
  const cols: Column<QuarantineCaseView>[] = [
    {key:"evidence",header:tr("Chứng cứ"),cell:r=>can("evidence.read")?<Button size="xs" variant="outline" onClick={()=>evidence.open(r)}>{tr("Chứng cứ")}</Button>:null},
    { key: "code", header: tr("Phiếu"), cell: (c) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{c.code}</span><span className="text-[12px] text-ink-2">{c.lotCode} · {c.siteName}</span></span> },
    { key: "cause", header: tr("Nguyên nhân"), hideBelow: "md", cell: (c) => <span className="flex flex-col text-[12.5px]"><span>{CAUSE_LABEL[c.cause]}</span><span className="text-ink-2">{c.reason}</span></span> },
    { key: "qty", header: tr("Còn cách ly / tổng"), cell: (c) => <span className="font-mono text-[12.5px]">{fmtNumber(c.openQuantity)} / {fmtNumber(c.quantity)} {c.unit}</span> },
    { key: "by", header: tr("Lập bởi"), hideBelow: "lg", cell: (c) => <span className="text-[12px]">{c.createdByName} · <span className="font-mono">{fmtDateTime(c.createdAt)}</span></span> },
    { key: "status", header: tr("Trạng thái"), cell: (c) => <Badge tone={c.status === "ACTIVE" ? "warn" : c.status === "RELEASED" ? "ok" : "neutral"}>{CASE_LABEL[c.status]}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (c) => (c.status === "ACTIVE" && lotOf(c) ? (
      <span className="flex flex-wrap gap-1">
        <Button size="xs" onClick={() => act.open({ c, kind: "RELEASE" })}>{tr("Giải tỏa")}</Button>
        {can("quantity.adjust") && <Button size="xs" variant="outline" onClick={() => act.open({ c, kind: "DISPOSE" })}>{tr("Ghi hư hỏng")}</Button>}
      </span>
    ) : null) },
  ];
  const lot = t && lotOf(t.c);
  const schema = t ? z.object({ quantity: qty.refine((v) => Number(v) <= Number(t.c.openQuantity), { error: () => tr("Vượt lượng còn cách ly") }), reason: reason(t.kind === "RELEASE" ? 10 : 3) }) : z.object({});
  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(c) => c.id} empty={<EmptyState title={tr("Chưa có phiếu cách ly")} />} />
      </div>
      {evidence.target&&<InventoryEvidence entityType="QUARANTINE" entityId={evidence.target.id} code={evidence.target.code} onClose={evidence.close}/>}
      {t && lot && (
        <CommandDialog
          {...act.props}
          title={t.kind === "RELEASE" ? tr("Giải tỏa phiếu {p0}", { p0: t.c.code }) : tr("Ghi hư hỏng phiếu {p0}", { p0: t.c.code })}
          endpoint={t.kind === "RELEASE" ? "POST /distribution/quarantine" : "POST /distribution/quantities"}
          description={t.kind === "RELEASE" ? tr("Trả lượng cách ly về tồn khả dụng; không giải tỏa được lô đã thu hồi hoặc hết hạn.") : tr("Ghi giảm lượng cách ly tại cơ sở và đóng phần tương ứng của phiếu.")}
          schema={schema as z.ZodObject<{ quantity: z.ZodString; reason: z.ZodString }>}
          defaultValues={{ quantity: t.c.openQuantity, reason: "" }}
          version={lot.version}
          tone={t.kind === "DISPOSE" ? "danger" : "default"}
          submitLabel={t.kind === "RELEASE" ? tr("Giải tỏa") : tr("Ghi hư hỏng")}
          invalidate={INVALIDATE}
          run={(v, cmd) =>
            t.kind === "RELEASE"
              ? distApi.quarantine({ lotId: t.c.lotId, siteId: t.c.siteId, unit: t.c.unit, version: lot.version, quantity: v.quantity, reason: v.reason, action: "RELEASE", quarantineCaseId: t.c.id }, cmd)
              : distApi.dispose({ lotId: t.c.lotId, siteId: t.c.siteId, unit: t.c.unit, version: lot.version, quantity: v.quantity, reason: v.reason, kind: "DAMAGE", fromQuarantine: true, quarantineCaseId: t.c.id }, cmd)
          }
        >
          {(f) => (
            <>
              <TextField control={f.control} name="quantity" label={tr("Số lượng ({p0})", { p0: t.c.unit })} inputMode="decimal" />
              <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}

function InventoryEvidence({entityType,entityId,code,onClose,details=[]}:{details?:[string,string|null|undefined][];entityType:"SITE_TRANSFER"|"QUARANTINE";entityId:string;code:string;onClose:()=>void}){const{can}=useWorkspaceAccess();return <Sheet open onOpenChange={open=>{if(!open)onClose();}}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{tr("Chứng cứ")} · {code}</SheetTitle><SheetDescription>{entityType==="SITE_TRANSFER"?tr("Phiếu chuyển kho"):tr("Phiếu cách ly")}</SheetDescription></SheetHeader><div className="flex flex-col gap-4 px-4 pb-6"><dl className="grid gap-2 text-sm">{details.filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="text-ink-2">{label}</dt><dd>{value}</dd></div>)}</dl>{can("evidence.read")&&<EvidencePanel entityType={entityType} entityId={entityId} canManage={can("evidence.manage")}/>}</div></SheetContent></Sheet>;}
