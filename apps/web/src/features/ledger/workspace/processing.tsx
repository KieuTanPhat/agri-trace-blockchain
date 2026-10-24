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
import { LOSS_REASONS, PROCESSING_TYPES, type ProcessingMaterial, type ProcessingRun, type UnitConversion } from "@/lib/ledger/proc-types";
import { wapi } from "@/lib/ledger/workspace-api";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { LineagePanel } from "@/components/ledger/workspace/lineage-panel";
import { cn } from "@/lib/ledger/utils";

export const PROCESS_TYPE_LABEL: Record<string, string> = localized({ PRELIMINARY: "Sơ chế", PACKING: "Đóng gói", DRYING: "Sấy", FREEZING: "Cấp đông", MILLING: "Xay xát", JUICE_EXTRACT: "Ép nước", FERMENTING: "Lên men", OTHER: "Khác" });
const LOSS_LABEL: Record<string, string> = localized({ TRIMMING: "Gọt, tỉa", MOISTURE: "Mất ẩm", SPILLAGE: "Rơi vãi", QUALITY_REJECT: "Loại do chất lượng", SAMPLING: "Lấy mẫu", OTHER: "Khác" });
const RUN_LABEL: Record<string, string> = localized({ DRAFT: "Nháp", COMPLETED: "Đã hoàn tất", CANCELLED: "Đã hủy" });
const RUN_TONE: Record<string, "info" | "ok" | "neutral"> = { DRAFT: "info", COMPLETED: "ok", CANCELLED: "neutral" };
const QTY = /^(?:0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;
const qty = z.string().regex(QTY, { error: () => tr("Số không âm, tối đa 3 chữ số thập phân") });
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export default function ProcessingPage({runId,view="list"}:{runId?:string;view?:"list"|"new"|"detail"|"conversions"}) {
 const router=useRouter(),createdId=useRef<string|null>(null);
 const [status,setStatus]=useState("");
  const { can, access } = useWorkspaceAccess();
  const [tab, setTab] = useState<"runs" | "materials" | "conversions">(view==="conversions"?"conversions":"runs");
  const [openId, setOpenId] = useState<string | null>(runId??null);
  const runs = useQuery({ queryKey: ["proc-runs",status], queryFn: () => procApi.runs(status||undefined), enabled: can("processing.read") });
  const create = useDialog();
  if (!(view==="conversions"?can("catalog.read"):can("processing.read"))) return <ErrorState error={new Error(tr("Bạn chưa có quyền processing.read"))} />;
  const processor = access?.capabilities.includes("PROCESSOR");
  const cols: Column<ProcessingRun>[] = [
    { key: "code", header: tr("Lệnh"), cell: (r) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{r.code}</span><span className="text-[12px] text-ink-2">{PROCESS_TYPE_LABEL[r.processType]} · {r.chainName}</span></span> },
    { key: "in", header: tr("Nguyên liệu"), hideBelow: "md", cell: (r) => <span className="text-[12.5px]">{r.inputs.map((i) => `${i.lotCode} (${fmtNumber(i.quantity)} ${i.unit})`).join(", ")}</span> },
    { key: "out", header: tr("Thành phẩm"), hideBelow: "lg", cell: (r) => <span className="text-[12.5px]">{r.outputs.map((o) => `${o.productName}: ${fmtNumber(o.quantity)} ${o.unit}`).join(", ")}</span> },
    { key: "at", header: tr("Lập lúc"), hideBelow: "lg", cell: (r) => <span className="font-mono text-[12px]">{fmtDateTime(r.createdAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (r) => <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (r) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/processing/${r.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <>
      <PageHeader
        title={tr("Chế biến")}
        description={tr("Lệnh chế biến biến lô nguyên liệu đang giữ tại cơ sở chế biến/đóng gói thành lô thành phẩm mới có mã truy xuất riêng. Đầu vào phải bằng thành phẩm (quy về đơn vị cơ sở) cộng hao hụt, trong sai lệch nền tảng cho phép.")}
        actions={can("processing.write") && processor && <Button size="sm" onClick={() => router.push("/enterprise/processing/new")}><Plus /> {tr("Lập lệnh chế biến")}</Button>}
      />
      <PageBody>
        <label className="text-sm">{tr("Trạng thái lệnh")}<select className="ml-2 rounded-md border border-line bg-card p-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="">{tr("Tất cả")}</option>{Object.entries(RUN_LABEL).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        {!processor && <Callout tone="info">{tr("Doanh nghiệp chưa được duyệt năng lực chế biến nên chỉ xem được lệnh và nguyên liệu; lập lệnh cần năng lực PROCESSOR.")}</Callout>}
        <div role="tablist" className="flex flex-wrap gap-1">
          {(["runs", "materials", "conversions"] as const).filter(k=>k==="conversions"?can("catalog.read"):can("processing.read")).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {{ runs: tr("Lệnh chế biến"), materials: tr("Nguyên liệu tại xưởng"), conversions: tr("Hệ số quy đổi") }[k]}
            </button>
          ))}
        </div>
        {tab === "runs" && (
          <div className="overflow-hidden rounded-md border border-line bg-card">
            <DataTable rows={runs.data} loading={runs.isLoading} error={runs.error} onRetry={() => runs.refetch()} columns={cols} rowKey={(r) => r.id} empty={<EmptyState title={tr("Chưa có lệnh chế biến")} />} />
          </div>
        )}
        {tab === "materials" && <Materials />}
        {tab === "conversions" && <Conversions />}
      </PageBody>
      <RunSheet id={openId} onClose={() => {setOpenId(null);router.push("/enterprise/processing");}}/>
      {(create.target||view==="new")&&can("processing.write")&&processor&&<CreateRun props={{open:true,onOpenChange:o=>{if(!o){create.close();if(view==="new"&&!createdId.current)router.push("/enterprise/processing");}}}} onCreated={id=>{createdId.current=id;router.push(`/enterprise/processing/${id}`);}}/>}
    </>
  );
}

// ---------------------------------------------------------------------------
function Materials() {
  const q = useQuery({ queryKey: ["proc-materials"], queryFn: procApi.materials });
  const cols: Column<ProcessingMaterial>[] = [
    { key: "lot", header: tr("Lô"), cell: (m) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{m.lotCode}</span><span className="text-[12px] text-ink-2">{m.productName}</span></span> },
    { key: "src", header: tr("Nguồn"), hideBelow: "md", cell: (m) => <span className="text-[12.5px]">{m.sourceOrganization}</span> },
    { key: "site", header: tr("Cơ sở"), cell: (m) => <span className="text-[12.5px]">{m.siteName}</span> },
    { key: "avail", header: tr("Khả dụng"), cell: (m) => <span className="font-mono text-[12.5px]">{fmtNumber(m.available)} {m.unit}</span> },
    { key: "exp", header: tr("Hạn dùng"), hideBelow: "lg", cell: (m) => <span className="font-mono text-[12px]">{m.expiryDate ? fmtDate(m.expiryDate) : "—"}</span> },
    { key: "state", header: tr("Dùng được"), cell: (m) => (m.blocked ? <Badge tone="danger" dot={false}>{tr("Bị chặn")}</Badge> : <Badge tone="ok" dot={false}>{tr("Có")}</Badge>) },
  ];
  return (
    <div className="overflow-hidden rounded-md border border-line bg-card">
      <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(m) => `${m.lotId}-${m.siteId}`} empty={<EmptyState title={tr("Không có nguyên liệu tại cơ sở chế biến hoặc đóng gói")} />} />
    </div>
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
                <TextField control={f.control} name="unit" label={tr("Đơn vị ghi nhận")} />
                <TextField control={f.control} name="factor" label={tr("Hệ số")} inputMode="decimal" />
                <TextField control={f.control} name="baseUnit" label={tr("Đơn vị cơ sở")} />
              </div>
              <TextField control={f.control} name="note" label={tr("Ghi chú (tùy chọn)")} />
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
const createSchema = z.object({
  chainId: z.string().min(1, { error: () => tr("Chọn chuỗi") }),
  siteId: z.string().min(1, { error: () => tr("Chọn cơ sở") }),
  processType: z.enum(PROCESSING_TYPES),
  baseUnit: z.string().trim().min(1).max(30),
  recipe: z.string().max(500).optional(),
  note: z.string().max(1000).optional(),
  inputs: z.array(z.object({ lotId: z.string().min(1, { error: () => tr("Chọn lô") }), quantity: qty })).min(1).max(20),
  outputs: z
    .array(
      z.object({
        productId: z.string().min(1, { error: () => tr("Chọn sản phẩm") }),
        kind: z.enum(["PRODUCT", "BY_PRODUCT"]),
        quantity: qty,
        unit: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(30),
        lotName: z.string().max(255).optional(),grade:z.string().max(100).optional(),packaging:z.string().max(255).optional(),packageCount:z.union([z.literal(""),z.coerce.number<number>().int().min(1).max(10000000)]).optional(),
        expiryDate: z.string().optional(),
      }),
    )
    .min(1)
    .max(10)
    .refine((o) => o.some((x) => x.kind === "PRODUCT"), { error: () => tr("Cần ít nhất một thành phẩm chính") }),
  losses: z.array(z.object({ reason: z.enum(LOSS_REASONS), quantity: qty, note: z.string().max(500).optional() })).max(10),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateRun({ props, onCreated }: { props: { open: boolean; onOpenChange: (o: boolean) => void }; onCreated: (id: string) => void }) {
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: wapi.chains });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites });
  const materials = useQuery({ queryKey: ["proc-materials"], queryFn: procApi.materials });
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog });
  const conversions = useQuery({ queryKey: ["proc-conversions"], queryFn: () => procApi.conversions() });
  const {user}=useAuth();
  const loadError=chains.error??sites.error??materials.error??catalog.error??conversions.error;
  if(loadError)return <ErrorState error={loadError}/>;
  if(!chains.data||!sites.data||!materials.data||!catalog.data||!conversions.data)return <LoadingRows rows={4}/>;
  const workSites = (sites.data ?? []).filter((s) => s.status === "ACTIVE" && ["PROCESSING", "PACKING"].includes(s.kind));
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId===user?.organizationId);
  return (
    <CommandDialog
      {...props}
      title={tr("Lập lệnh chế biến")}
      endpoint="POST /processing-runs"
      description={tr("Lệnh được lưu ở trạng thái nháp; nguyên liệu chỉ bị tiêu hao và lô thành phẩm chỉ được tạo khi hoàn tất lệnh.")}
      schema={createSchema}
      defaultValues={{ chainId: chains.data?.[0]?.id ?? "", siteId: workSites[0]?.id ?? "", processType: "DRYING", baseUnit: "kg", recipe: "", note: "", inputs: [{ lotId: "", quantity: "" }], outputs: [{ productId: "", kind: "PRODUCT", quantity: "", unit: "", lotName: "",grade:"",packaging:"",packageCount:"",expiryDate: "" }], losses: [] }}
      submitLabel={tr("Lưu lệnh nháp")}
      invalidate={[["proc-runs"]]}
      wide
      onDone={(r) => onCreated((r as ProcessingRun).id)}
      run={(v, cmd) =>
        procApi.create(
          {
            ...v,
            recipe: v.recipe || undefined,
            note: v.note || undefined,
            outputs: v.outputs.map((o) => ({ productId: o.productId, kind: o.kind, quantity: o.quantity, unit: o.unit, lotName: o.lotName || undefined,grade:o.grade||undefined,packaging:o.packaging||undefined,packageCount:typeof o.packageCount==="number"?o.packageCount:undefined,expiryDate: o.expiryDate || undefined })),
            losses: v.losses.map((l) => ({ ...l, note: l.note || undefined })),
          },
          cmd,
        )
      }
    >
      {(f) => {
        const c = f.control as unknown as Control<CreateValues>;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField control={c} name="chainId" label={tr("Chuỗi cung ứng")} options={(chains.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              <SelectField control={c} name="siteId" label={tr("Cơ sở chế biến / đóng gói")} options={workSites.map((s) => ({ value: s.id, label: s.name }))} />
              <SelectField control={c} name="processType" label={tr("Loại chế biến")} options={PROCESSING_TYPES.map((k) => ({ value: k, label: PROCESS_TYPE_LABEL[k] }))} />
              <TextField control={c} name="baseUnit" label={tr("Đơn vị cơ sở")} hint={tr("Đơn vị của mọi lô đầu vào")} />
            </div>
            <InputsField control={c} materials={materials.data ?? []} />
            <OutputsField control={c} products={products} />
            <LossesField control={c} />
            <Balance control={c} conversions={conversions.data ?? []} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={c} name="recipe" label={tr("Công thức (tùy chọn)")} />
              <TextField control={c} name="note" label={tr("Ghi chú (tùy chọn)")} />
            </div>
          </>
        );
      }}
    </CommandDialog>
  );
}

function InputsField({ control, materials }: { control: Control<CreateValues>; materials: ProcessingMaterial[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: "inputs" });
  const [siteId, chainId] = useWatch({ control, name: ["siteId", "chainId"] });
  const options = materials.filter((m) => m.siteId === siteId && m.chainId === chainId && !m.blocked && Number(m.available)>0).map((m) => ({ value: m.lotId, label: `${m.lotCode} · ${m.productName} · ${tr("khả dụng")} ${fmtNumber(m.available)} ${m.unit}` }));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">{tr("Nguyên liệu (tối đa 20 lô)")}</legend>
      {!options.length && <p className="text-[12.5px] text-ink-2">{tr("Cơ sở đã chọn chưa giữ lô khả dụng nào thuộc chuỗi này.")}</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
          <SelectField control={control} name={`inputs.${i}.lotId`} label={tr("Lô nguyên liệu {p0}", { p0: i + 1 })} options={options} />
          <TextField control={control} name={`inputs.${i}.quantity`} label={tr("Lượng dùng")} inputMode="decimal" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => append({ lotId: "", quantity: "" })} disabled={fields.length >= 20}><Plus /> {tr("Thêm lô nguyên liệu")}</Button>
    </fieldset>
  );
}

function OutputsField({ control, products }: { control: Control<CreateValues>; products: { id: string; productName: string; defaultUnit: string | null }[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: "outputs" });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">{tr("Thành phẩm và phụ phẩm (tối đa 10)")}</legend>
      {fields.map((f, i) => (
        <div key={f.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_150px_auto] items-end gap-2">
            <SelectField control={control} name={`outputs.${i}.productId`} label={tr("Sản phẩm {p0}", { p0: i + 1 })} options={products.map((p) => ({ value: p.id, label: p.productName }))} />
            <SelectField control={control} name={`outputs.${i}.kind`} label={tr("Loại")} options={[{ value: "PRODUCT", label: tr("Thành phẩm chính") }, { value: "BY_PRODUCT", label: tr("Phụ phẩm") }]} />
            <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 /></Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <TextField control={control} name={`outputs.${i}.quantity`} label={tr("Số lượng")} inputMode="decimal" />
            <TextField control={control} name={`outputs.${i}.unit`} label={tr("Đơn vị")} />
            <TextField control={control} name={`outputs.${i}.lotName`} label={tr("Tên lô (tùy chọn)")} />
            <TextField control={control} name={`outputs.${i}.grade`} label={tr("Phân loại (tùy chọn)")}/><TextField control={control} name={`outputs.${i}.packaging`} label={tr("Quy cách đóng gói (tùy chọn)")}/><TextField control={control} name={`outputs.${i}.packageCount`} label={tr("Số kiện (tùy chọn)")} type="number"/>
            <TextField control={control} name={`outputs.${i}.expiryDate`} label={tr("Hạn dùng (tùy chọn)")} type="date" />
          </div>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => append({ productId: "", kind: "BY_PRODUCT", quantity: "", unit: "kg", lotName: "", expiryDate: "" })} disabled={fields.length >= 10}><Plus /> {tr("Thêm thành phẩm")}</Button>
    </fieldset>
  );
}

function LossesField({ control }: { control: Control<CreateValues> }) {
  const { fields, append, remove } = useFieldArray({ control, name: "losses" });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">{tr("Hao hụt (đơn vị cơ sở)")}</legend>
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-2 sm:grid-cols-[150px_100px_minmax(0,1fr)_auto] items-end gap-2">
          <SelectField control={control} name={`losses.${i}.reason`} label={tr("Lý do hao hụt {p0}", { p0: i + 1 })} options={LOSS_REASONS.map((k) => ({ value: k, label: LOSS_LABEL[k] }))} />
          <TextField control={control} name={`losses.${i}.quantity`} label={tr("Lượng")} inputMode="decimal" />
          <TextField control={control} name={`losses.${i}.note`} label={tr("Ghi chú")} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => remove(i)}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => append({ reason: "MOISTURE", quantity: "", note: "" })} disabled={fields.length >= 10}><Plus /> {tr("Thêm hao hụt")}</Button>
    </fieldset>
  );
}

/** Xem trước cân bằng khối lượng; máy chủ tính lại và quyết định theo sai lệch cho phép. */
function Balance({ control, conversions }: { control: Control<CreateValues>; conversions: UnitConversion[] }) {
  const [inputs, outputs, losses, baseUnit] = useWatch({ control, name: ["inputs", "outputs", "losses", "baseUnit"] });
  const sum = (xs: number[]) => r3(xs.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0));
  const missing: string[] = [];
  const outBase = outputs.map((o) => {
    const q = Number(o.quantity) || 0;
    if (!o.unit || same(o.unit, baseUnit)) return q;
    const c = conversions.find((x) => !x.revokedAt && x.productId === o.productId && same(x.unit, o.unit) && same(x.baseUnit, baseUnit));
    if (!c) {
      if (o.productId) missing.push(o.unit);
      return 0;
    }
    return r3(q * Number(c.factor));
  });
  const input = sum(inputs.map((i) => Number(i.quantity)));
  const output = sum(outBase);
  const loss = sum(losses.map((l) => Number(l.quantity)));
  const diff = r3(input - output - loss);
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[12.5px]", diff === 0 ? "border-ok/40 bg-ok/5" : "border-warn/40 bg-warn/5")} aria-live="polite">
      <span className="font-mono">
        {tr("Đầu vào {p0} = thành phẩm {p1} + hao hụt {p2}", { p0: fmtNumber(input), p1: fmtNumber(output), p2: fmtNumber(loss) })} {baseUnit}
      </span>
      {diff !== 0 && <span className="ml-2">· {tr("lệch {p0} {p1}", { p0: fmtNumber(diff), p1: baseUnit })}</span>}
      <p className="mt-1 text-ink-2">{tr("Ước tính theo hệ số hiện hành; máy chủ kiểm lại khi lưu và hoàn tất.")}</p>
      {missing.length > 0 && <p className="mt-1 text-ink-2">{tr("Chưa có hệ số quy đổi cho: {p0}", { p0: [...new Set(missing)].join(", ") })}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function RunSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { can,access } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["proc-run", id], queryFn: () => procApi.run(id!), enabled: !!id });
  const act = useDialog<"COMPLETE" | "CANCEL">();
  const [lineage, setLineage] = useState<string | null>(null);
  const r = q.data;
  const invalidate = [["proc-run", id], ["proc-runs"], ["proc-materials"], ["dist-report"], ["ws-lots"], ["lineage"]];
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!r ? (
          q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{r.code}</SheetTitle>
              <SheetDescription>{PROCESS_TYPE_LABEL[r.processType]} · {r.chainName} · v{r.version}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status]}</Badge>
                {r.status === "DRAFT" && can("processing.write") && (
                  <>
                    {access?.capabilities.includes("PROCESSOR")&&<Button size="sm" onClick={() => act.open("COMPLETE")}>{tr("Hoàn tất lệnh")}</Button>}
                    <Button size="sm" variant="outline" onClick={() => act.open("CANCEL")}>{tr("Hủy lệnh")}</Button>
                  </>
                )}
              </div>
              {r.cancelReason && <Callout tone="info">{tr("Lý do hủy: {p0}", { p0: r.cancelReason })}</Callout>}
              {r.status === "COMPLETED" && (
                <p className="font-mono text-[12.5px]">{tr("Đầu vào {p0} = thành phẩm {p1} + hao hụt {p2}", { p0: fmtNumber(r.inputTotal), p1: fmtNumber(r.outputTotal), p2: fmtNumber(r.lossTotal) })} {r.baseUnit} · {tr("sai lệch")} {r.variancePercent}%</p>
              )}
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
                </ul>
              </section>
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
              {r.losses.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Hao hụt")}</h3>
                  <ul className="flex flex-col gap-1 text-[13px]">
                    {r.losses.map((l, i) => <li key={i}>{LOSS_LABEL[l.reason]}: <span className="font-mono">{fmtNumber(l.quantity)} {r.baseUnit}</span>{l.note ? ` · ${l.note}` : ""}</li>)}
                  </ul>
                </section>
              )}
              {(r.recipe || r.note) && (
                <dl className="grid grid-cols-[minmax(0,120px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                  {r.recipe && (<><dt className="text-ink-2">{tr("Công thức")}</dt><dd>{r.recipe}</dd></>)}
                  {r.note && (<><dt className="text-ink-2">{tr("Ghi chú")}</dt><dd>{r.note}</dd></>)}
                </dl>
              )}
            </div>
            {act.target === "COMPLETE" && can("processing.write") && access?.capabilities.includes("PROCESSOR") && (
              <CommandDialog {...act.props} title={tr("Hoàn tất lệnh {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/complete" description={tr("Trừ nguyên liệu tại xưởng, tạo lô thành phẩm kèm mã truy xuất và tồn tại cơ sở, ghi sự kiện cho từng lô. Máy chủ kiểm lại năng lực, sản phẩm, hệ số quy đổi, thông báo thu hồi và tồn khả dụng.")} schema={z.object({})} defaultValues={{}} version={r.version} submitLabel={tr("Hoàn tất")} invalidate={invalidate} run={(_, cmd) => procApi.complete(r.id, { version: r.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {act.target === "CANCEL" && can("processing.write") && (
              <CommandDialog {...act.props} title={tr("Hủy lệnh {p0}", { p0: r.code })} endpoint="POST /processing-runs/:id/cancel" schema={z.object({ reason: z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(1000) })} defaultValues={{ reason: "" }} version={r.version} tone="danger" submitLabel={tr("Hủy lệnh")} invalidate={invalidate} run={(v, cmd) => procApi.cancel(r.id, { version: r.version, reason: v.reason }, cmd)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
