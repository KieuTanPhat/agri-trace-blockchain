"use client";

import { useRef,useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {useAuth} from "@/lib/auth-store";
import {EvidencePanel} from "@/components/ledger/workspace/evidence-panel";
import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import { procApi } from "@/lib/ledger/proc-api";
import { LOSS_REASONS, PROCESSING_STEPS, PROCESSING_TYPES, type MaterialReceipt, type ProcessingMaterial, type ProcessingRun, type StockItem, type UnitConversion } from "@/lib/ledger/proc-types";
import { wapi } from "@/lib/ledger/workspace-api";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { ReferenceSelectField } from "@/components/ledger/kit/reference-select";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { LineagePanel } from "@/components/ledger/workspace/lineage-panel";
import { cn } from "@/lib/ledger/utils";

export const PROCESS_TYPE_LABEL: Record<string, string> = localized({ PRELIMINARY: "Sơ chế", PACKING: "Đóng gói", DRYING: "Sấy", FREEZING: "Cấp đông", MILLING: "Xay xát", JUICE_EXTRACT: "Ép nước", FERMENTING: "Lên men", OTHER: "Khác" });
const LOSS_LABEL: Record<string, string> = localized({ TRIMMING: "Gọt, tỉa", MOISTURE: "Mất ẩm", SPILLAGE: "Rơi vãi", QUALITY_REJECT: "Loại do chất lượng", SAMPLING: "Lấy mẫu", OTHER: "Khác" });
const RUN_LABEL: Record<string, string> = localized({ DRAFT: "Kế hoạch", IN_PROGRESS: "Đang chế biến", COMPLETED: "Đã ra lò", CANCELLED: "Đã hủy" });
const RUN_TONE: Record<string, "info" | "ok" | "neutral" | "warn"> = { DRAFT: "info", IN_PROGRESS: "warn", COMPLETED: "ok", CANCELLED: "neutral" };
export const STEP_LABEL: Record<string, string> = localized({ RECEIVING: "Tiếp nhận nguyên liệu", SORTING: "Phân loại", WASHING: "Rửa", PRELIMINARY: "Sơ chế", DRYING: "Sấy", ROASTING: "Rang", MILLING: "Xay / nghiền", FERMENTING: "Lên men", COOKING: "Nấu / chần", FREEZING: "Cấp đông", PACKING: "Đóng gói", QUALITY_CHECK: "Kiểm tra chất lượng", CORRECTION: "Đính chính", OTHER: "Khác" });
const QTY = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;
const qty = z.string().regex(QTY, { error: () => tr("Số không âm, tối đa 3 chữ số thập phân") });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
type Tab = "runs" | "stock" | "receipts" | "conversions";

export default function ProcessingPage({runId,view="list"}:{runId?:string;view?:"list"|"new"|"detail"|"conversions"}) {
 const router=useRouter(),createdId=useRef<string|null>(null);
 const [status,setStatus]=useState("");
  const { can, access } = useWorkspaceAccess();
  const [tab, setTab] = useState<Tab>(view==="conversions"?"conversions":"runs");
  const [openId, setOpenId] = useState<string | null>(runId??null);
  const runs = useQuery({ queryKey: ["proc-runs",status], queryFn: () => procApi.runs(status||undefined), enabled: can("processing.read") });
  const create = useDialog();
  if (!(view==="conversions"?can("catalog.read"):can("processing.read"))) return <ErrorState error={new Error(tr("Bạn chưa có quyền processing.read"))} />;
  const processor = access?.capabilities.includes("PROCESSOR");
  const cols: Column<ProcessingRun>[] = [
    { key: "code", header: tr("Lệnh"), cell: (r) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{r.code}</span><span className="text-[12px] text-ink-2">{r.productName ?? "—"} · {PROCESS_TYPE_LABEL[r.processType]} · {r.chainName}</span></span> },
    { key: "in", header: tr("Nguyên liệu"), hideBelow: "md", cell: (r) => <span className="text-[12.5px]">{[...r.inputs.map((i) => `${i.lotCode} (${fmtNumber(i.quantity)} ${i.unit})`), ...(r.externalInputs ?? []).map((i) => `${i.materialName} (${fmtNumber(i.quantity)} ${i.unit}, ${tr("nhập ngoài")})`)].join(", ")}</span> },
    { key: "out", header: tr("Thành phẩm"), hideBelow: "lg", cell: (r) => <span className="text-[12.5px]">{r.outputs.length ? r.outputs.map((o) => `${o.productName}: ${fmtNumber(o.quantity)} ${o.unit}`).join(", ") : "—"}</span> },
    { key: "at", header: tr("Lập lúc"), hideBelow: "lg", cell: (r) => <span className="font-mono text-[12px]">{fmtDateTime(r.createdAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (r) => <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (r) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/processing/${r.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <>
      <PageHeader
        title={tr("Chế biến")}
        description={tr("Lập kế hoạch với sản phẩm cần chế biến và nguyên liệu, bắt đầu để giữ chỗ nguyên liệu, ghi nhật ký từng bước rồi ra lò. Ra lò trừ nguyên liệu, tạo lô thành phẩm có mã truy xuất riêng; nguyên liệu bằng thành phẩm (quy về đơn vị cơ sở) cộng phụ phẩm và hao hụt.")}
        actions={can("processing.write") && processor && <Button size="sm" onClick={() => router.push("/enterprise/processing/new")}><Plus /> {tr("Lập kế hoạch chế biến")}</Button>}
      />
      <PageBody>
        {!processor && <Callout tone="info">{tr("Doanh nghiệp chưa được duyệt năng lực chế biến nên chỉ xem được lệnh và nguyên liệu; lập lệnh cần năng lực PROCESSOR.")}</Callout>}
        <div role="tablist" className="flex flex-wrap gap-1">
          {(["runs", "stock", "receipts", "conversions"] as const).filter(k=>k==="conversions"?can("catalog.read"):can("processing.read")).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {{ runs: tr("Lệnh chế biến"), stock: tr("Tồn kho chế biến"), receipts: tr("Phiếu nhập nguyên liệu"), conversions: tr("Hệ số quy đổi") }[k]}
            </button>
          ))}
        </div>
        {tab === "runs" && (
          <>
            <label className="text-sm">{tr("Trạng thái lệnh")}<select className="ml-2 rounded-md border border-line bg-card p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">{tr("Tất cả")}</option>{Object.entries(RUN_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
            <div className="overflow-hidden rounded-md border border-line bg-card">
              <DataTable rows={runs.data} loading={runs.isLoading} error={runs.error} onRetry={() => runs.refetch()} columns={cols} rowKey={(r) => r.id} empty={<EmptyState title={tr("Chưa có lệnh chế biến")} />} />
            </div>
          </>
        )}
        {tab === "stock" && <Stock />}
        {tab === "receipts" && <Receipts processor={!!processor} />}
        {tab === "conversions" && <Conversions />}
      </PageBody>
      <RunSheet id={openId} onClose={() => {setOpenId(null);router.push("/enterprise/processing");}}/>
      {(create.target||view==="new")&&can("processing.write")&&processor&&<CreateRun props={{open:true,onOpenChange:o=>{if(!o){create.close();if(view==="new"&&!createdId.current)router.push("/enterprise/processing");}}}} onCreated={id=>{createdId.current=id;router.push(`/enterprise/processing/${id}`);}}/>}
    </>
  );
}

// ---------------------------------------------------------------------------
/** Tồn theo số lượng tại cơ sở chế biến/đóng gói: nguyên liệu và thành phẩm. */
function Stock() {
  const q = useQuery({ queryKey: ["proc-stock"], queryFn: procApi.stock });
  const cols: Column<StockItem>[] = [
    { key: "item", header: tr("Mặt hàng"), cell: (m) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{m.source === "EXTERNAL" ? m.receiptCode : m.lotCode}</span><span className="text-[12px] text-ink-2">{m.productName}</span></span> },
    { key: "src", header: tr("Nguồn"), hideBelow: "md", cell: (m) => <span className="text-[12.5px]">{m.sourceOrganization}{m.source === "EXTERNAL" ? ` · ${tr("nhập ngoài, tự khai")}` : ""}</span> },
    { key: "site", header: tr("Cơ sở"), cell: (m) => <span className="text-[12.5px]">{m.siteName ?? "—"}</span> },
    { key: "avail", header: tr("Khả dụng"), cell: (m) => <span className="font-mono text-[12.5px]">{fmtNumber(m.available)} {m.unit}</span> },
    { key: "exp", header: tr("Hạn dùng"), hideBelow: "lg", cell: (m) => <span className="font-mono text-[12px]">{m.expiryDate ? fmtDate(m.expiryDate) : "—"}</span> },
    { key: "state", header: tr("Dùng được"), cell: (m) => (m.blocked ? <Badge tone="danger" dot={false}>{tr("Bị chặn")}</Badge> : <Badge tone="ok" dot={false}>{tr("Có")}</Badge>) },
  ];
  const key = (m: StockItem) => m.source === "EXTERNAL" ? `r:${m.receiptId}` : `l:${m.lotId}-${m.siteId}`;
  return (
    <div className="flex flex-col gap-4">
      <Callout tone="info">{tr("Tồn chỉ theo số lượng. Phần đang giữ chỗ cho lệnh đang chế biến không còn khả dụng.")}</Callout>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{tr("Nguyên liệu")}</h3>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={q.data?.materials} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={key} empty={<EmptyState title={tr("Chưa có nguyên liệu tại cơ sở chế biến hoặc đóng gói")} />} />
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{tr("Thành phẩm sau chế biến")}</h3>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={q.data?.products} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={key} empty={<EmptyState title={tr("Chưa có thành phẩm")} />} />
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
const receiptSchema = z.object({
  siteId: z.string().min(1, { error: () => tr("Chọn cơ sở") }),
  materialName: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  supplierName: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  documentNo: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(100),
  receivedAt: z.string().min(1, { error: () => tr("Chọn ngày nhập") }),
  quantity: qty.refine((v) => Number(v) > 0, { error: () => tr("Phải lớn hơn 0") }),
  unit: z.string().trim().min(1).max(30),
  expiryDate: z.string().optional(),
  note: z.string().max(1000).optional(),
});

/** Phiếu nhập: tự sinh khi xác nhận thực nhận từ giao nhận AgriTrace, hoặc nhập ngoài kèm chứng từ. */
function Receipts({ processor }: { processor: boolean }) {
  const { can } = useWorkspaceAccess();
  const [source, setSource] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["proc-receipts", source], queryFn: () => procApi.receipts(source || undefined) });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("processing.write") });
  const create = useDialog();
  const workSites = (sites.data ?? []).filter((s) => s.status === "ACTIVE" && ["PROCESSING", "PACKING"].includes(s.kind));
  const cols: Column<MaterialReceipt>[] = [
    { key: "code", header: tr("Phiếu"), cell: (r) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{r.code}</span><span className="text-[12px] text-ink-2">{fmtDateTime(r.receivedAt)}</span></span> },
    { key: "src", header: tr("Nguồn"), cell: (r) => <Badge tone={r.source === "EXTERNAL" ? "warn" : "ok"} dot={false}>{r.source === "EXTERNAL" ? tr("Nhập ngoài (tự khai)") : tr("Giao nhận AgriTrace")}</Badge> },
    { key: "mat", header: tr("Nguyên liệu"), cell: (r) => <span className="flex flex-col"><span className="text-[13px] font-medium">{r.materialName}</span><span className="text-[12px] text-ink-2">{r.supplierName}{r.documentNo ? ` · ${r.documentNo}` : ""}</span></span> },
    { key: "site", header: tr("Cơ sở"), hideBelow: "md", cell: (r) => <span className="text-[12.5px]">{r.siteName ?? "—"}</span> },
    { key: "qty", header: tr("Lượng nhập"), cell: (r) => <span className="font-mono text-[12.5px]">{fmtNumber(r.quantity)} {r.unit}</span> },
    { key: "avail", header: tr("Còn dùng được"), hideBelow: "lg", cell: (r) => <span className="font-mono text-[12.5px]">{r.source === "EXTERNAL" ? `${fmtNumber(r.available)} ${r.unit}` : tr("Theo tồn lô")}</span> },
    { key: "ev", header: tr("Chứng từ"), hideBelow: "lg", cell: (r) => (r.source === "EXTERNAL" ? (r.hasEvidence ? <Badge tone="ok" dot={false}>{tr("Đã có")}</Badge> : <Badge tone="danger" dot={false}>{tr("Thiếu ảnh")}</Badge>) : <span>—</span>) },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (r) => <Button size="xs" variant="outline" onClick={() => setOpenId(r.id)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <div className="flex flex-col gap-3">
      <Callout tone="info">{tr("Hàng nhận qua phiếu giao nhận AgriTrace vào cơ sở chế biến/đóng gói tự có phiếu nhập theo lượng thực nhận. Nguyên liệu mua ngoài lập phiếu nhập và tải hóa đơn hoặc giấy kiểm nghiệm; mã QR thành phẩm ghi rõ nguồn này do doanh nghiệp tự khai.")}</Callout>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm">{tr("Nguồn")}<select className="ml-2 rounded-md border border-line bg-card p-2" value={source} onChange={(e) => setSource(e.target.value)}><option value="">{tr("Tất cả")}</option><option value="AGRITRACE">{tr("Giao nhận AgriTrace")}</option><option value="EXTERNAL">{tr("Nhập ngoài")}</option></select></label>
        {can("processing.write") && processor && <Button size="sm" onClick={() => create.open(true)}><Plus /> {tr("Nhập nguyên liệu ngoài")}</Button>}
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(r) => r.id} empty={<EmptyState title={tr("Chưa có phiếu nhập")} />} />
      </div>
      {create.target && (
        <CommandDialog {...create.props} title={tr("Nhập nguyên liệu ngoài")} endpoint="POST /processing-runs/receipts" description={tr("Phiếu không sửa được sau khi lưu. Sau khi lưu, tải ảnh hóa đơn/chứng từ để dùng nguyên liệu trong lệnh chế biến.")} schema={receiptSchema} defaultValues={{ siteId: workSites[0]?.id ?? "", materialName: "", supplierName: "", documentNo: "", receivedAt: localNow(), quantity: "", unit: "kg", expiryDate: "", note: "" }} submitLabel={tr("Lưu phiếu nhập")} invalidate={[["proc-receipts"], ["proc-stock"]]} onDone={(r) => setOpenId((r as MaterialReceipt).id)}
          run={(v, cmd) => procApi.createReceipt({ ...v, receivedAt: new Date(v.receivedAt).toISOString(), expiryDate: v.expiryDate || undefined, note: v.note || undefined }, cmd)}>
          {(f) => (
            <>
              <SelectField control={f.control} name="siteId" label={tr("Cơ sở nhận")} options={workSites.map((s) => ({ value: s.id, label: s.name }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField control={f.control} name="materialName" label={tr("Tên nguyên liệu")} />
                <TextField control={f.control} name="supplierName" label={tr("Nhà cung cấp")} />
                <TextField control={f.control} name="documentNo" label={tr("Số hóa đơn / chứng từ")} />
                <TextField control={f.control} name="receivedAt" label={tr("Ngày nhập")} type="datetime-local" />
                <TextField control={f.control} name="quantity" label={tr("Số lượng")} inputMode="decimal" />
                <ReferenceSelectField control={f.control} name="unit" label={tr("Đơn vị")} category="UNIT" />
                <TextField control={f.control} name="expiryDate" label={tr("Hạn dùng")} type="date" />
                <TextField control={f.control} name="note" label={tr("Ghi chú")} />
              </div>
            </>
          )}
        </CommandDialog>
      )}
      <ReceiptSheet id={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function ReceiptSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["proc-receipt", id], queryFn: () => procApi.receipt(id!), enabled: !!id });
  const r = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {!r ? (q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={5} />) : (
          <>
            <SheetHeader>
              <SheetTitle>{r.code}</SheetTitle>
              <SheetDescription>{r.source === "EXTERNAL" ? tr("Nhập ngoài AgriTrace (doanh nghiệp tự khai)") : tr("Phiếu giao nhận AgriTrace")}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-6">
              <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-ink-2">{tr("Nguyên liệu")}</dt><dd>{r.materialName}</dd>
                <dt className="text-ink-2">{tr("Nhà cung cấp")}</dt><dd>{r.supplierName}</dd>
                <dt className="text-ink-2">{r.source === "EXTERNAL" ? tr("Số chứng từ") : tr("Mã lô")}</dt><dd className="font-mono">{r.documentNo ?? "—"}</dd>
                <dt className="text-ink-2">{tr("Cơ sở nhận")}</dt><dd>{r.siteName ?? "—"}</dd>
                <dt className="text-ink-2">{tr("Ngày nhập")}</dt><dd>{fmtDateTime(r.receivedAt)}</dd>
                <dt className="text-ink-2">{tr("Lượng nhập")}</dt><dd className="font-mono">{fmtNumber(r.quantity)} {r.unit}</dd>
                {r.source === "EXTERNAL" && (<>
                  <dt className="text-ink-2">{tr("Đang giữ chỗ")}</dt><dd className="font-mono">{fmtNumber(r.reserved)} {r.unit}</dd>
                  <dt className="text-ink-2">{tr("Đã dùng")}</dt><dd className="font-mono">{fmtNumber(r.consumed)} {r.unit}</dd>
                  <dt className="text-ink-2">{tr("Còn dùng được")}</dt><dd className="font-mono">{fmtNumber(r.available)} {r.unit}</dd>
                </>)}
                <dt className="text-ink-2">{tr("Hạn dùng")}</dt><dd>{r.expiryDate ? fmtDate(r.expiryDate) : "—"}</dd>
                {r.note && (<><dt className="text-ink-2">{tr("Ghi chú")}</dt><dd>{r.note}</dd></>)}
              </dl>
              {r.source === "EXTERNAL" && !r.hasEvidence && <Callout tone="warn">{tr("Phiếu chưa có ảnh chứng từ nên chưa dùng được trong lệnh chế biến.")}</Callout>}
              {r.source === "EXTERNAL" && can("evidence.read") && <EvidencePanel entityType="MATERIAL_RECEIPT" entityId={r.id} canManage={can("evidence.manage") || can("processing.write")} required={[{ kind: "RECEIPT_DOCUMENT", min: 1 }]} title={tr("Hóa đơn và giấy kiểm nghiệm")} onChanged={() => q.refetch()} />}
              {!!r.uses?.length && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Lệnh chế biến đã dùng")}</h3>
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {r.uses.map((u) => <li key={u.runId}><Link className="font-mono text-brand underline" href={`/enterprise/processing/${u.runId}`}>{u.runCode}</Link> · {fmtNumber(u.quantity)} {r.unit} · {RUN_LABEL[u.status]}</li>)}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
function Conversions() {
 const {user}=useAuth();
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["proc-conversions"], queryFn: () => procApi.conversions() });
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog, enabled: can("catalog.manage") });
  const create = useDialog();
  const revoke = useDialog<UnitConversion>();
  const cols: Column<UnitConversion>[] = [
    { key: "product", header: tr("Sản phẩm"), cell: (c) => <span className="font-medium">{c.productName}</span> },
    { key: "factor", header: tr("Quy đổi"), cell: (c) => <span className="font-mono text-[12.5px]">1 {c.unit} = {c.factor} {c.baseUnit}</span> },
    { key: "note", header: tr("Ghi chú"), hideBelow: "md", cell: (c) => <span className="text-[12.5px] text-ink-2">{c.revokedAt ? `${tr("Thu hồi")}: ${c.revokeReason}` : c.note ?? "—"}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (c) => <Badge tone={c.revokedAt ? "neutral" : "ok"}>{c.revokedAt ? tr("Đã thu hồi") : tr("Đang dùng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (c) => (!c.revokedAt && can("catalog.manage") ? <Button size="xs" variant="outline" onClick={() => revoke.open(c)}>{tr("Thu hồi")}</Button> : null) },
  ];
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId===user?.organizationId);
  return (
    <div className="flex flex-col gap-3">
      <Callout tone="info">{tr("Hệ số cho biết một đơn vị ghi nhận (ví dụ gói) bằng bao nhiêu đơn vị cơ sở của lệnh (ví dụ kg). Hệ số không sửa được: thu hồi rồi khai hệ số mới; lệnh nháp dựa trên hệ số đã thu hồi sẽ không hoàn tất được.")}</Callout>
      {can("catalog.manage") && <Button size="sm" className="self-start" onClick={() => create.open(true)}><Plus /> {tr("Khai hệ số quy đổi")}</Button>}
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(c) => c.id} empty={<EmptyState title={tr("Chưa khai hệ số quy đổi")} />} />
      </div>
      {create.target && (
        <CommandDialog {...create.props} title={tr("Khai hệ số quy đổi")} endpoint="POST /processing-runs/unit-conversions" schema={z.object({ productId: z.string().min(1, { error: () => tr("Chọn sản phẩm") }), unit: z.string().trim().min(1).max(30), baseUnit: z.string().trim().min(1).max(30), factor: z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,6})?$/, { error: () => tr("Tối đa 6 chữ số thập phân") }).refine((v) => Number(v) > 0, { error: () => tr("Phải lớn hơn 0") }), note: z.string().max(500).optional() }).refine((v) => !same(v.unit, v.baseUnit), { path: ["unit"], error: () => tr("Đơn vị ghi nhận phải khác đơn vị cơ sở") })} defaultValues={{ productId: "", unit: "", baseUnit: "kg", factor: "", note: "" }} submitLabel={tr("Khai hệ số")} invalidate={[["proc-conversions"]]} run={(v, cmd) => procApi.createConversion({ ...v, note: v.note || undefined }, cmd)}>
          {(f) => (
            <>
              <SelectField control={f.control} name="productId" label={tr("Sản phẩm")} options={products.map((p) => ({ value: p.id, label: p.productName }))} />
              <div className="grid gap-3 sm:grid-cols-3">
                <ReferenceSelectField control={f.control} name="unit" label={tr("Đơn vị ghi nhận")} category="UNIT" />
                <TextField control={f.control} name="factor" label={tr("Hệ số")} inputMode="decimal" />
                <ReferenceSelectField control={f.control} name="baseUnit" label={tr("Đơn vị cơ sở")} category="UNIT" />
              </div>
              <TextField control={f.control} name="note" label={tr("Ghi chú")} />
            </>
          )}
        </CommandDialog>
      )}
      {revoke.target && (
        <CommandDialog {...revoke.props} title={tr("Thu hồi hệ số {p0}", { p0: `1 ${revoke.target.unit} = ${revoke.target.factor} ${revoke.target.baseUnit}` })} endpoint="POST /processing-runs/unit-conversions/:id/revoke" schema={z.object({ reason: z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(500) })} defaultValues={{ reason: "" }} tone="danger" submitLabel={tr("Thu hồi")} invalidate={[["proc-conversions"]]} run={(v, cmd) => procApi.revokeConversion(revoke.target!.id, v, cmd)}>
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={500} />}
        </CommandDialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
const lotLine = z.object({ lotId: z.string().min(1, { error: () => tr("Chọn lô") }), quantity: qty });
const extLine = z.object({ receiptId: z.string().min(1, { error: () => tr("Chọn phiếu nhập") }), quantity: qty });
const linesSchema = z.object({ inputs: z.array(lotLine).max(20), externalInputs: z.array(extLine).max(20) });
const createSchema = linesSchema.extend({
  chainId: z.string().min(1, { error: () => tr("Chọn chuỗi") }),
  siteId: z.string().min(1, { error: () => tr("Chọn cơ sở") }),
  productId: z.string().min(1, { error: () => tr("Chọn sản phẩm cần chế biến") }),
  processType: z.enum(PROCESSING_TYPES),
  baseUnit: z.string().trim().min(1).max(30),
  recipe: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
}).refine((v) => v.inputs.length + v.externalInputs.length > 0, { path: ["inputs"], error: () => tr("Chọn ít nhất một nguyên liệu") });
type LineValues = z.infer<typeof linesSchema>;

/** Lập kế hoạch: sản phẩm chính và nguyên liệu; chưa giữ chỗ kho. */
function CreateRun({ props, onCreated }: { props: { open: boolean; onOpenChange: (o: boolean) => void }; onCreated: (id: string) => void }) {
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: wapi.chains });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites });
  const materials = useQuery({ queryKey: ["proc-materials"], queryFn: procApi.materials });
  const stock = useQuery({ queryKey: ["proc-stock"], queryFn: procApi.stock });
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog });
  const {user}=useAuth();
  const loadError=chains.error??sites.error??materials.error??stock.error??catalog.error;
  if(loadError)return <ErrorState error={loadError}/>;
  if(!chains.data||!sites.data||!materials.data||!stock.data||!catalog.data)return <LoadingRows rows={4}/>;
  const workSites = (sites.data ?? []).filter((s) => s.status === "ACTIVE" && ["PROCESSING", "PACKING"].includes(s.kind));
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId===user?.organizationId);
  const external = stock.data.materials.filter((m) => m.source === "EXTERNAL");
  return (
    <CommandDialog
      {...props}
      title={tr("Lập kế hoạch chế biến")}
      endpoint="POST /processing-runs"
      description={tr("Kế hoạch chưa giữ chỗ kho. Khi bắt đầu, nguyên liệu được giữ chỗ; thành phẩm, phụ phẩm và hao hụt ghi khi ra lò.")}
      schema={createSchema}
      defaultValues={{ chainId: chains.data?.[0]?.id ?? "", siteId: workSites[0]?.id ?? "", productId: "", processType: "DRYING", baseUnit: "kg", recipe: "", note: "", inputs: [], externalInputs: [] }}
      submitLabel={tr("Lưu kế hoạch")}
      invalidate={[["proc-runs"]]}
      wide
      onDone={(r) => onCreated((r as ProcessingRun).id)}
      run={(v, cmd) => procApi.create({ ...v, recipe: v.recipe || undefined, note: v.note || undefined }, cmd)}
    >
      {(f) => {
        const c = f.control as unknown as Control<LineValues & { siteId: string; chainId: string; baseUnit: string }>;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField control={f.control} name="productId" label={tr("Sản phẩm cần chế biến")} options={products.map((p) => ({ value: p.id, label: p.productName }))} />
              <SelectField control={f.control} name="chainId" label={tr("Chuỗi cung ứng")} options={(chains.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              <SelectField control={f.control} name="siteId" label={tr("Cơ sở chế biến / đóng gói")} options={workSites.map((s) => ({ value: s.id, label: s.name }))} />
              <SelectField control={f.control} name="processType" label={tr("Loại chế biến")} options={PROCESSING_TYPES.map((k) => ({ value: k, label: PROCESS_TYPE_LABEL[k] }))} />
              <ReferenceSelectField control={f.control} name="baseUnit" label={tr("Đơn vị cơ sở")} category="UNIT" />
            </div>
            <MaterialLines control={c} materials={materials.data ?? []} external={external} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={f.control} name="recipe" label={tr("Công thức / quy trình")} />
              <TextField control={f.control} name="note" label={tr("Ghi chú")} />
            </div>
          </>
        );
      }}
    </CommandDialog>
  );
}

/** Dòng nguyên liệu: lô AgriTrace cùng chuỗi và phiếu nhập ngoài cùng đơn vị, tại cơ sở của lệnh. */
function MaterialLines({ control, materials, external, fixed, exclude }: { control: Control<LineValues & { siteId: string; chainId: string; baseUnit: string }>; materials: ProcessingMaterial[]; external: StockItem[]; fixed?: { siteId: string; chainId: string; baseUnit: string }; exclude?: { lotIds: string[]; receiptIds: string[] } }) {
  const lots = useFieldArray({ control, name: "inputs" });
  const ext = useFieldArray({ control, name: "externalInputs" });
  const watched = useWatch({ control, name: ["siteId", "chainId", "baseUnit"] });
  const [siteId, chainId, baseUnit] = fixed ? [fixed.siteId, fixed.chainId, fixed.baseUnit] : watched;
  const lotOptions = materials.filter((m) => m.siteId === siteId && m.chainId === chainId && same(m.unit, baseUnit ?? "") && !m.blocked && Number(m.available) > 0 && !exclude?.lotIds.includes(m.lotId)).map((m) => ({ value: m.lotId, label: `${m.lotCode} · ${m.productName} · ${tr("khả dụng")} ${fmtNumber(m.available)} ${m.unit}` }));
  const extOptions = external.filter((m) => m.siteId === siteId && same(m.unit, baseUnit ?? "") && !m.blocked && Number(m.available) > 0 && !exclude?.receiptIds.includes(m.receiptId!)).map((m) => ({ value: m.receiptId!, label: `${m.receiptCode} · ${m.productName} · ${m.sourceOrganization} · ${tr("khả dụng")} ${fmtNumber(m.available)} ${m.unit}` }));
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{tr("Lô nguyên liệu AgriTrace (tối đa 20)")}</legend>
        {!lotOptions.length && <p className="text-[12.5px] text-ink-2">{tr("Cơ sở đã chọn chưa giữ lô khả dụng nào thuộc chuỗi và đơn vị này.")}</p>}
        {lots.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
            <SelectField control={control} name={`inputs.${i}.lotId`} label={tr("Lô nguyên liệu {p0}", { p0: i + 1 })} options={lotOptions} />
            <TextField control={control} name={`inputs.${i}.quantity`} label={tr("Lượng dùng")} inputMode="decimal" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => lots.remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => lots.append({ lotId: "", quantity: "" })} disabled={lots.fields.length >= 20 || !lotOptions.length}><Plus /> {tr("Thêm lô nguyên liệu")}</Button>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{tr("Nguyên liệu nhập ngoài (tự khai, cần chứng từ)")}</legend>
        {!extOptions.length && <p className="text-[12.5px] text-ink-2">{tr("Chưa có phiếu nhập ngoài khả dụng tại cơ sở với đơn vị này. Lập ở tab Phiếu nhập nguyên liệu.")}</p>}
        {ext.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
            <SelectField control={control} name={`externalInputs.${i}.receiptId`} label={tr("Phiếu nhập {p0}", { p0: i + 1 })} options={extOptions} />
            <TextField control={control} name={`externalInputs.${i}.quantity`} label={tr("Lượng dùng")} inputMode="decimal" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => ext.remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => ext.append({ receiptId: "", quantity: "" })} disabled={ext.fields.length >= 20 || !extOptions.length}><Plus /> {tr("Thêm nguyên liệu nhập ngoài")}</Button>
      </fieldset>
    </>
  );
}

// ---------------------------------------------------------------------------
const completeSchema = z.object({
  quantity: qty.refine((v) => Number(v) > 0, { error: () => tr("Phải lớn hơn 0") }),
  unit: z.string().trim().min(1).max(30),
  lotName: z.string().max(255).optional(), grade: z.string().max(100).optional(), packaging: z.string().max(255).optional(),
  packageCount: z.union([z.literal(""), z.coerce.number<number>().int().min(1).max(10000000)]).optional(),
  expiryDate: z.string().optional(),
  byProducts: z.array(z.object({ productId: z.string().min(1, { error: () => tr("Chọn sản phẩm") }), quantity: qty, unit: z.string().trim().min(1).max(30) })).max(10),
  losses: z.array(z.object({ reason: z.enum(LOSS_REASONS), quantity: qty, note: z.string().max(500).optional() })).max(10),
});
type CompleteValues = z.infer<typeof completeSchema>;
const logSchema = z.object({
  step: z.enum(PROCESSING_STEPS),
  occurredAt: z.string().min(1, { error: () => tr("Chọn thời điểm") }),
  note: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(2000),
  correctsId: z.string().optional(),
}).refine((v) => v.step !== "CORRECTION" || !!v.correctsId, { path: ["correctsId"], error: () => tr("Chọn dòng được đính chính") });

function RunSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can,access } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["proc-run", id], queryFn: () => procApi.run(id!), enabled: !!id });
  const act = useDialog<"START" | "INPUTS" | "LOG" | "COMPLETE" | "CANCEL">();
  const [lineage, setLineage] = useState<string | null>(null);
  const r = q.data;
  const open = r?.status === "DRAFT" || r?.status === "IN_PROGRESS";
  const materials = useQuery({ queryKey: ["proc-materials"], queryFn: procApi.materials, enabled: !!open });
  const stock = useQuery({ queryKey: ["proc-stock"], queryFn: procApi.stock, enabled: !!open });
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog, enabled: r?.status === "IN_PROGRESS" });
  const conversions = useQuery({ queryKey: ["proc-conversions"], queryFn: () => procApi.conversions(), enabled: r?.status === "IN_PROGRESS" });
  const {user}=useAuth();
  const invalidate = [["proc-run", id], ["proc-runs"], ["proc-materials"], ["proc-stock"], ["proc-receipts"], ["dist-report"], ["ws-lots"], ["lineage"]];
  const processor = access?.capabilities.includes("PROCESSOR");
  const write = can("processing.write");
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId===user?.organizationId);
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!r ? (
          q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{r.code}</SheetTitle>
              <SheetDescription>{r.productName ?? "—"} · {PROCESS_TYPE_LABEL[r.processType]} · {r.chainName} · v{r.version}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                {open && write && (
                  <>
                    {r.status === "DRAFT" && processor && r.productId && <Button size="sm" onClick={() => act.open("START")}>{tr("Bắt đầu chế biến")}</Button>}
                    {r.status === "IN_PROGRESS" && processor && <Button size="sm" onClick={() => act.open("COMPLETE")}>{tr("Ra lò")}</Button>}
                    {r.status === "IN_PROGRESS" && <Button size="sm" variant="outline" onClick={() => act.open("LOG")}>{tr("Ghi nhật ký")}</Button>}
                    {r.productId && <Button size="sm" variant="outline" onClick={() => act.open("INPUTS")}>{tr("Bổ sung nguyên liệu")}</Button>}
                    <Button size="sm" variant="outline" onClick={() => act.open("CANCEL")}>{tr("Hủy lệnh")}</Button>
                  </>
                )}
              </div>
              {r.status === "DRAFT" && !r.productId && <Callout tone="warn">{tr("Lệnh nháp cũ chưa có sản phẩm chính nên không theo vòng đời mới; hủy và lập kế hoạch mới.")}</Callout>}
              {r.status === "DRAFT" && r.productId && <Callout tone="info">{tr("Bắt đầu chế biến sẽ giữ chỗ toàn bộ nguyên liệu tại cơ sở; hủy lệnh trả lại phần giữ chỗ.")}</Callout>}
              {r.cancelReason && <Callout tone="info">{tr("Lý do hủy: {p0}", { p0: r.cancelReason })}</Callout>}
              {r.status === "COMPLETED" && (
                <p className="font-mono text-[12.5px]">{tr("Đầu vào {p0} = thành phẩm {p1} + hao hụt {p2}", { p0: fmtNumber(r.inputTotal), p1: fmtNumber(r.outputTotal), p2: fmtNumber(r.lossTotal) })} {r.baseUnit} · {tr("sai lệch")} {r.variancePercent}%</p>
              )}
              <dl className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-ink-2">{tr("Lập lúc")}</dt><dd>{fmtDateTime(r.createdAt)}</dd>
                {r.startedAt && (<><dt className="text-ink-2">{tr("Bắt đầu")}</dt><dd>{fmtDateTime(r.startedAt)}</dd></>)}
                {r.completedAt && (<><dt className="text-ink-2">{tr("Ra lò")}</dt><dd>{fmtDateTime(r.completedAt)}</dd></>)}
                {r.recipe && (<><dt className="text-ink-2">{tr("Công thức")}</dt><dd>{r.recipe}</dd></>)}
                {r.note && (<><dt className="text-ink-2">{tr("Ghi chú")}</dt><dd>{r.note}</dd></>)}
              </dl>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Nguyên liệu")}</h3>
                <ul className="divide-y divide-line/70 rounded-md border border-line">
                  {r.inputs.map((i) => (
                    <li key={i.lotId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                      <span className="font-mono text-[12px]">{i.lotCode}</span>
                      <span className="text-ink-2">{i.productName} · {i.sourceOrganization}</span>
                      <span className="ml-auto font-mono text-[12px]">{fmtNumber(i.quantity)} {i.unit}{i.availableQuantity !== null ? ` · ${tr("xưởng còn")} ${fmtNumber(i.availableQuantity)}` : ""}</span>
                    </li>
                  ))}
                  {(r.externalInputs ?? []).map((i) => (
                    <li key={i.receiptId} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                      <Badge tone="warn" dot={false}>{tr("Nhập ngoài")}</Badge>
                      <span className="font-mono text-[12px]">{i.receiptCode}</span>
                      <span className="text-ink-2">{i.materialName} · {i.supplierName}{i.documentNo ? ` · ${i.documentNo}` : ""}</span>
                      <span className="ml-auto font-mono text-[12px]">{fmtNumber(i.quantity)} {i.unit}</span>
                    </li>
                  ))}
                </ul>
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Nhật ký chế biến")}</h3>
                <p className="text-[12px] text-ink-2">{tr("Ghi rồi không sửa hay xóa; sai thì ghi dòng đính chính. Các bước hiện trên mã QR công khai, không hiện người ghi.")}</p>
                {!(r.logs ?? []).length ? <p className="text-[12.5px] text-ink-2">{r.status === "IN_PROGRESS" ? tr("Chưa có nhật ký.") : tr("Nhật ký mở khi lệnh bắt đầu.")}</p> : (
                  <ol className="flex flex-col gap-2">
                    {r.logs.map((l) => (
                      <li key={l.id} className="flex flex-col gap-1 rounded-md border border-line px-3 py-2 text-[13px]">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={l.step === "CORRECTION" ? "warn" : "neutral"} dot={false}>{STEP_LABEL[l.step] ?? l.step}</Badge>
                          <span className="font-mono text-[12px]">{fmtDateTime(l.occurredAt)}</span>
                        </span>
                        <span>{l.note}</span>
                        {l.correctsId && <span className="text-[12px] text-ink-2">{tr("Đính chính cho dòng lúc {p0}", { p0: fmtDateTime(r.logs.find((x) => x.id === l.correctsId)?.occurredAt ?? "") })}</span>}
                        {can("evidence.read") && <EvidencePanel entityType="PROCESSING_LOG" entityId={l.id} canManage={write && r.status === "IN_PROGRESS"} title={tr("Ảnh bước (không bắt buộc)")} />}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              {r.outputs.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Thành phẩm")}</h3>
                  <ul className="divide-y divide-line/70 rounded-md border border-line">
                    {r.outputs.map((o) => (
                      <li key={o.id} className="flex flex-col gap-1 px-3 py-2 text-[13px]">
                        <span className="flex flex-wrap items-center gap-2">
                          <Badge tone={o.kind === "PRODUCT" ? "brand" : "neutral"} dot={false}>{o.kind === "PRODUCT" ? tr("Thành phẩm chính") : tr("Phụ phẩm")}</Badge>
                          <span className="font-medium">{o.productName}</span>
                          <span className="ml-auto font-mono text-[12px]">{fmtNumber(o.quantity)} {o.unit} = {fmtNumber(o.baseQuantity)} {r.baseUnit}</span>
                        </span>
                        {o.lotCode && (
                          <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                            {tr("Lô mới")} <Link className="font-mono text-brand underline" href={`/lots/${o.lotId}`}>{o.lotCode}</Link>
                            {o.expiryDate && <span>· HSD {fmtDate(o.expiryDate)}</span>}
                            <Button size="xs" variant="ghost" onClick={() => setLineage(lineage === o.lotId ? null : o.lotId)}>{lineage === o.lotId ? tr("Ẩn truy xuất") : tr("Truy ngược")}</Button>
                          </span>
                        )}
                        <p className="text-xs text-ink-2">{[o.lotName,o.grade,o.packaging,o.packageCount?`${o.packageCount} ${tr("kiện")}`:null].filter(Boolean).join(" · ")}</p>
                        {o.lotId&&can("evidence.read")&&<EvidencePanel entityType="LOT" entityId={o.lotId} canManage={can("evidence.manage")}/>}
                        {lineage && lineage === o.lotId && <LineagePanel lotId={o.lotId} />}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {r.losses.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Hao hụt")}</h3>
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {r.losses.map((l, i) => <li key={i}>{LOSS_LABEL[l.reason]}: <span className="font-mono">{fmtNumber(l.quantity)} {r.baseUnit}</span>{l.note ? ` · ${l.note}` : ""}</li>)}
                  </ul>
                </section>
              )}
            </div>
            {act.target === "START" && write && processor && (
              <CommandDialog {...act.props} title={tr("Bắt đầu lệnh {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/start" description={tr("Giữ chỗ toàn bộ nguyên liệu tại cơ sở và mở nhật ký chế biến. Máy chủ kiểm lại tồn khả dụng, hạn dùng và chứng từ nhập ngoài.")} schema={z.object({})} defaultValues={{}} version={r.version} submitLabel={tr("Xác nhận bắt đầu")} invalidate={invalidate} run={(_, cmd) => procApi.start(r.id, { version: r.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {act.target === "INPUTS" && write && (
              materials.data && stock.data ? (
                <CommandDialog {...act.props} title={tr("Bổ sung nguyên liệu cho {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/inputs" description={r.status === "IN_PROGRESS" ? tr("Nguyên liệu bổ sung được giữ chỗ ngay.") : undefined} schema={linesSchema.refine((v) => v.inputs.length + v.externalInputs.length > 0, { path: ["inputs"], error: () => tr("Chọn ít nhất một nguyên liệu") })} defaultValues={{ inputs: [], externalInputs: [] }} version={r.version} submitLabel={tr("Bổ sung")} invalidate={invalidate} wide run={(v, cmd) => procApi.addInputs(r.id, { version: r.version, ...v }, cmd)}>
                  {(f) => <MaterialLines control={f.control as unknown as Control<LineValues & { siteId: string; chainId: string; baseUnit: string }>} materials={materials.data!} external={stock.data!.materials.filter((m) => m.source === "EXTERNAL")} fixed={{ siteId: r.siteId, chainId: r.chainId, baseUnit: r.baseUnit }} exclude={{ lotIds: r.inputs.map((i) => i.lotId), receiptIds: (r.externalInputs ?? []).map((i) => i.receiptId) }} />}
                </CommandDialog>
              ) : <LoadingRows rows={2} />
            )}
            {act.target === "LOG" && write && (
              <CommandDialog {...act.props} title={tr("Ghi nhật ký {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/logs" description={tr("Ảnh (không bắt buộc) tải ở từng dòng nhật ký sau khi ghi.")} schema={logSchema} defaultValues={{ step: "PRELIMINARY", occurredAt: localNow(), note: "", correctsId: "" }} submitLabel={tr("Ghi nhật ký")} invalidate={invalidate}
                run={(v, cmd) => procApi.addLog(r.id, { step: v.step, occurredAt: new Date(v.occurredAt).toISOString(), note: v.note, correctsId: v.step === "CORRECTION" ? v.correctsId : undefined }, cmd)}>
                {(f) => <LogFields control={f.control} logs={r.logs ?? []} />}
              </CommandDialog>
            )}
            {act.target === "COMPLETE" && write && processor && (
              <CommandDialog {...act.props} title={tr("Ra lò {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/complete" description={tr("Ra lò một lần: trừ nguyên liệu đã giữ chỗ, tạo lô thành phẩm kèm mã truy xuất và tồn tại cơ sở, ghi sự kiện cho từng lô kèm nguồn nhập ngoài và nhật ký.")} schema={completeSchema} defaultValues={{ quantity: "", unit: r.baseUnit, lotName: "", grade: "", packaging: "", packageCount: "", expiryDate: "", byProducts: [], losses: [] }} version={r.version} submitLabel={tr("Xác nhận ra lò")} invalidate={invalidate} wide
                run={(v, cmd) => procApi.complete(r.id, {
                  version: r.version,
                  output: { quantity: v.quantity, unit: v.unit, lotName: v.lotName || undefined, grade: v.grade || undefined, packaging: v.packaging || undefined, packageCount: typeof v.packageCount === "number" ? v.packageCount : undefined, expiryDate: v.expiryDate || undefined },
                  byProducts: v.byProducts.map((b) => ({ ...b, kind: "BY_PRODUCT" })),
                  losses: v.losses.map((l) => ({ ...l, note: l.note || undefined })),
                }, cmd)}>
                {(f) => <CompleteFields control={f.control as unknown as Control<CompleteValues>} run={r} products={products} conversions={conversions.data ?? []} />}
              </CommandDialog>
            )}
            {act.target === "CANCEL" && write && (
              <CommandDialog {...act.props} title={tr("Hủy lệnh {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/cancel" description={r.status === "IN_PROGRESS" ? tr("Phần nguyên liệu đang giữ chỗ được trả lại kho.") : undefined} schema={z.object({ reason: z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(1000) })} defaultValues={{ reason: "" }} version={r.version} tone="danger" submitLabel={tr("Hủy lệnh")} invalidate={invalidate} run={(v, cmd) => procApi.cancel(r.id, { version: r.version, reason: v.reason }, cmd)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LogFields({ control, logs }: { control: Control<z.infer<typeof logSchema>>; logs: ProcessingRun["logs"] }) {
  const step = useWatch({ control, name: "step" });
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={control} name="step" label={tr("Bước")} options={PROCESSING_STEPS.filter((k) => k !== "CORRECTION" || logs.length > 0).map((k) => ({ value: k, label: STEP_LABEL[k] }))} />
        <TextField control={control} name="occurredAt" label={tr("Thời điểm thực hiện")} type="datetime-local" />
      </div>
      {step === "CORRECTION" && <SelectField control={control} name="correctsId" label={tr("Dòng được đính chính")} options={logs.map((l) => ({ value: l.id, label: `${fmtDateTime(l.occurredAt)} · ${STEP_LABEL[l.step] ?? l.step}` }))} />}
      <TextAreaField control={control} name="note" label={tr("Ghi chú")} max={2000} />
    </>
  );
}

function CompleteFields({ control, run, products, conversions }: { control: Control<CompleteValues>; run: ProcessingRun; products: { id: string; productName: string }[]; conversions: UnitConversion[] }) {
  const by = useFieldArray({ control, name: "byProducts" });
  const loss = useFieldArray({ control, name: "losses" });
  const [quantity, unit, byProducts, losses] = useWatch({ control, name: ["quantity", "unit", "byProducts", "losses"] });
  const base = (productId: string | null, q: string, u: string) => {
    const n = Number(q) || 0;
    if (!u || same(u, run.baseUnit)) return n;
    const c = conversions.find((x) => !x.revokedAt && x.productId === productId && same(x.unit, u) && same(x.baseUnit, run.baseUnit));
    return c ? r3(n * Number(c.factor)) : NaN;
  };
  const input = r3([...run.inputs, ...(run.externalInputs ?? [])].reduce((a, i) => a + Number(i.quantity), 0));
  const outs = [base(run.productId, quantity, unit), ...byProducts.map((b) => base(b.productId, b.quantity, b.unit))];
  const missing = outs.some((n) => Number.isNaN(n));
  const output = r3(outs.reduce((a, n) => a + (Number.isNaN(n) ? 0 : n), 0));
  const lost = r3(losses.reduce((a, l) => a + (Number(l.quantity) || 0), 0));
  const diff = r3(input - output - lost);
  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{tr("Thành phẩm chính: {p0}", { p0: run.productName ?? "—" })}</legend>
        <div className="grid gap-2 sm:grid-cols-4">
          <TextField control={control} name="quantity" label={tr("Số lượng")} inputMode="decimal" />
          <ReferenceSelectField control={control} name="unit" label={tr("Đơn vị")} category="UNIT" />
          <TextField control={control} name="lotName" label={tr("Tên lô")} />
          <TextField control={control} name="grade" label={tr("Phân loại")} />
          <TextField control={control} name="packaging" label={tr("Quy cách đóng gói")} />
          <TextField control={control} name="packageCount" label={tr("Số kiện")} type="number" />
          <TextField control={control} name="expiryDate" label={tr("Hạn dùng")} type="date" />
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{tr("Phụ phẩm (tối đa 10)")}</legend>
        {by.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_110px_120px_auto] items-end gap-2">
            <SelectField control={control} name={`byProducts.${i}.productId`} label={tr("Phụ phẩm {p0}", { p0: i + 1 })} options={products.map((p) => ({ value: p.id, label: p.productName }))} />
            <TextField control={control} name={`byProducts.${i}.quantity`} label={tr("Số lượng")} inputMode="decimal" />
            <ReferenceSelectField control={control} name={`byProducts.${i}.unit`} label={tr("Đơn vị")} category="UNIT" />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => by.remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => by.append({ productId: "", quantity: "", unit: run.baseUnit })} disabled={by.fields.length >= 10}><Plus /> {tr("Thêm phụ phẩm")}</Button>
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{tr("Hao hụt (đơn vị cơ sở)")}</legend>
        {loss.fields.map((f, i) => (
          <div key={f.id} className="grid grid-cols-2 sm:grid-cols-[150px_100px_minmax(0,1fr)_auto] items-end gap-2">
            <SelectField control={control} name={`losses.${i}.reason`} label={tr("Lý do hao hụt {p0}", { p0: i + 1 })} options={LOSS_REASONS.map((k) => ({ value: k, label: LOSS_LABEL[k] }))} />
            <TextField control={control} name={`losses.${i}.quantity`} label={tr("Lượng")} inputMode="decimal" />
            <TextField control={control} name={`losses.${i}.note`} label={tr("Ghi chú")} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => loss.remove(i)}><Trash2 /></Button>
          </div>
        ))}
        <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => loss.append({ reason: "MOISTURE", quantity: "", note: "" })} disabled={loss.fields.length >= 10}><Plus /> {tr("Thêm hao hụt")}</Button>
      </fieldset>
      <div className={cn("rounded-md border px-3 py-2 text-[12.5px]", diff === 0 && !missing ? "border-ok/40 bg-ok/5" : "border-warn/40 bg-warn/5")} aria-live="polite">
        <span className="font-mono">{tr("Đầu vào {p0} = thành phẩm {p1} + hao hụt {p2}", { p0: fmtNumber(input), p1: fmtNumber(output), p2: fmtNumber(lost) })} {run.baseUnit}</span>
        {diff !== 0 && <span className="ml-2">· {tr("lệch {p0} {p1}", { p0: fmtNumber(diff), p1: run.baseUnit })}</span>}
        <p className="mt-1 text-ink-2">{tr("Ước tính theo hệ số hiện hành; máy chủ kiểm lại khi ra lò.")}</p>
        {missing && <p className="mt-1 text-ink-2">{tr("Có thành phẩm khác đơn vị cơ sở nhưng chưa khai hệ số quy đổi.")}</p>}
      </div>
    </>
  );
}
