"use client";

import { useState } from "react";
import Link from "next/link";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import {sumQuantities} from "@/lib/quantity-display";
import { useWatch } from "react-hook-form";
import { z } from "zod";
import { Plus } from "lucide-react";
import { opsApi } from "@/lib/ledger/ops-api";
import {additionalEvidence} from "@/lib/ledger/ops-types";
import type { CycleList, CycleDraft } from "@/lib/ledger/ops-types";
import { wapi } from "@/lib/ledger/resource-api";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { isoToLocal, localToIso } from "@/lib/ledger/ops-dates";
import { useNow } from "@/lib/ledger/use-now";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { CARE_TYPE_LABEL, CARE_TYPES, CYCLE_STATE_LABEL, CYCLE_STATE_TONE, LOT_STATE_LABEL } from "@/lib/ledger/ops-labels";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { EvidencePick } from "@/components/ledger/workspace/evidence-pick";
import { cn } from "@/lib/ledger/utils";

const opt = (max: number) => z.string().trim().max(max).optional();
const posOpt = z.union([z.literal(""), z.coerce.number<number>().positive({ error: () => tr("Phải là số dương") })]).optional();
const pos = z.coerce.number<number>({ error: () => tr("Nhập số") }).positive({ error: () => tr("Phải là số dương") });
const id = (msg: () => string) => z.string().min(1, { error: msg });
// CreateProductionCycleDto / CreateProductionCycleDraftDto (production-cycles/dto.ts)
const base = {
  farmId: id(() => tr("Chọn vùng sản xuất")),
  productId: id(() => tr("Chọn sản phẩm")),
  seedMaterialId: z.string().optional(),
  responsibleUserId: z.string().optional(),
  cultivationMethod: opt(255),
  harvestUnit: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(30),
  maxHarvestQuantity: posOpt,
  note: opt(5000),
};
const dateOrder = (v: { startDate?: string; plannedHarvest?: string }) => !v.startDate || !v.plannedHarvest || v.plannedHarvest >= v.startDate;
const cycleSchema = z
  .object({ ...base, chainId: id(() => tr("Chọn chuỗi")), plotId: z.string().optional(), cycleCode: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(100), name: opt(255), cultivatedArea: posOpt, startDate: z.string().optional(), plannedHarvest: z.string().optional() })
  .refine(dateOrder, { path: ["plannedHarvest"], error: () => tr("Ngày dự kiến thu hoạch phải sau ngày bắt đầu") });
const draftSchema = z
  .object({ ...base, plotId: id(() => tr("Chọn thửa đất")), cycleCode: opt(100), name: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255), cultivatedArea: pos, startDate: z.string().min(1, { error: () => tr("Không được để trống") }), plannedHarvest: z.string().min(1, { error: () => tr("Không được để trống") }) })
  .refine(dateOrder, { path: ["plannedHarvest"], error: () => tr("Ngày dự kiến thu hoạch phải sau ngày bắt đầu") });
const linkSchema = z.object({ chainId: id(() => tr("Chọn chuỗi")) });
const plantSchema = z.object({ plantedAt: z.string().min(1, { error: () => tr("Không được để trống") }) });
const careSchema = z.object({
  name: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  careType: z.string().min(1, { error: () => tr("Chọn loại công việc") }).max(100),
  eventTime: z.string().min(1, { error: () => tr("Không được để trống") }),
  materialId: z.string().optional(),
  materialName:opt(255),activeIngredient:opt(255),withdrawalPeriod:z.union([z.literal(""),z.coerce.number<number>().int().nonnegative()]).optional(),performerUserId:z.string().optional(),
  quantity: posOpt,
  unit: opt(30),
  applicationArea: opt(255),
  method: opt(255),
  cropCondition: opt(500),
  note: opt(2000),
  images: z.array(z.string()).min(1, { error: () => tr("Chọn 1–5 ảnh nhật ký") }).max(5),
});
const harvestSchema = z
  .object({
    lotName: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
    lotCode: opt(120),
    harvestTime: z.string().min(1, { error: () => tr("Không được để trống") }),
    quantity: pos,
    unit: z.string().trim().min(1).max(30),
    grade: opt(100),
    harvestArea: opt(255),
    harvestMethod: opt(100),
    qualityNote: opt(2000),
    packageCount: z.union([z.literal(""), z.coerce.number<number>().int().min(1, { error: () => tr("≥ 1") })]).optional(),
    packaging: opt(255),
    packedAt: z.string().optional(),
    expiryDate: z.string().optional(),
    initialStorageSiteId: z.string().optional(),
    note: opt(2000),
    images: z.array(z.string()).min(1, { error: () => tr("Chọn 1–5 ảnh thu hoạch") }).max(5),
    lotImage: z.array(z.string()).length(1, { error: () => tr("Chọn một ảnh lô") }),
  })
  .refine((v) => !v.packedAt || v.packedAt >= v.harvestTime.slice(0, 10), { path: ["packedAt"], error: () => tr("Ngày đóng gói không trước ngày thu hoạch") })
  .refine((v) => !v.expiryDate || v.expiryDate >= (v.packedAt || v.harvestTime.slice(0, 10)), { path: ["expiryDate"], error: () => tr("Ngày hết hạn không trước ngày thu hoạch/đóng gói") });
const cancelSchema = z.object({ reason: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(500) });
const emptySchema = z.object({});
const blank = <V,>(v: V) => (v === "" || v === undefined || v === null ? undefined : v);

function useOptions() {
 const {user:actor}=useSession();
  const { can } = useWorkspaceAccess();
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog, enabled: can("catalog.read") });
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: wapi.chains });
  const materials = useQuery({ queryKey: ["ws-materials"], queryFn: wapi.materials, enabled: can("materials.read") });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("sites.read") });
  return {
    farms: (catalog.data?.farms ?? []).filter((f) => f.status === "ACTIVE" && f.evidenceComplete),
    plots: (catalog.data?.plots ?? []).filter((p) => p.status === "ACTIVE"),
    products: (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.evidenceComplete && p.organizationId===actor?.organizationId),
    chains: chains.data ?? [],
    seeds: (materials.data ?? []).filter((m) => m.kind === "SEED" && m.status === "ACTIVE" && m.evidenceComplete),
    inputs: (materials.data ?? []).filter((m) => m.status === "ACTIVE"),
    members: (members.data ?? []).filter((m) => m.accountStatus === "ACTIVE"),
    sites: (sites.data ?? []).filter((s) => s.status === "ACTIVE"),
  };
}
type Options = ReturnType<typeof useOptions>;

export default function CyclesPage({cycleId,view="list"}:{cycleId?:string;view?:string}) {
 const router=useRouter();
  const { can } = useWorkspaceAccess();
  const [tab, setTab] = useState<"cycles" | "drafts">(view==="draft"?"drafts":"cycles");
  const [openId, setOpenId] = useState<string | null>(cycleId && view!=="draft"?cycleId:null);
  const cycles = useQuery({ queryKey: ["ws-cycles"], queryFn: opsApi.cycles, enabled: can("production.read") });
  const drafts = useQuery({ queryKey: ["ws-cycle-drafts"], queryFn: opsApi.drafts, enabled: can("production.read") });
  const options = useOptions();
  const add = useDialog<"cycle" | "draft">();
  const link = useDialog<CycleDraft>();
  if (!can("production.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền production.read"))} />;
  const write = can("production.write");
  const cols: Column<CycleList>[] = [
    { key: "code", header: tr("Vụ"), sort: (c) => c.cycleCode, cell: (c) => <span className="flex flex-col"><span className="font-medium">{c.name ?? c.cycleCode}</span><span className="font-mono text-[11px] text-ink-2">{c.cycleCode}</span></span> },
    { key: "product", header: tr("Sản phẩm"), cell: (c) => <span className="text-[12.5px]">{c.product.productName}</span> },
    { key: "farm", header: tr("Vùng / thửa"), hideBelow: "md", cell: (c) => <span className="flex flex-col text-[12.5px]"><span>{c.farm.name}</span><span className="text-ink-2">{c.plot?.name ?? "—"}</span></span> },
    { key: "dates", header: tr("Bắt đầu → dự kiến thu"), hideBelow: "lg", cell: (c) => <span className="font-mono text-[12px]">{fmtDate(c.startDate)} → {fmtDate(c.plannedHarvest)}</span> },
    { key: "state", header: tr("Trạng thái"), cell: (c) => <Badge tone={CYCLE_STATE_TONE[c.currentState]}>{CYCLE_STATE_LABEL[c.currentState]}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (c) => <Button size="xs" variant="outline" onClick={() => router.push(`/production-cycles/${c.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  const draftCols: Column<CycleDraft>[] = [
    { key: "name", header: tr("Vụ nháp"), cell: (d) => <span className="flex flex-col"><Link className="font-medium text-brand underline" href={`/production-cycles/drafts/${d.id}`}>{d.name}</Link><span className="font-mono text-[11px] text-ink-2">{d.cycleCode}</span></span> },
    { key: "product", header: tr("Sản phẩm"), cell: (d) => <span className="text-[12.5px]">{options.products.find((p) => p.id === d.productId)?.productName ?? "—"}</span> },
    { key: "dates", header: tr("Bắt đầu → dự kiến thu"), hideBelow: "md", cell: (d) => <span className="font-mono text-[12px]">{fmtDate(d.startDate)} → {fmtDate(d.plannedHarvest)}</span> },
    { key: "created", header: tr("Tạo lúc"), hideBelow: "lg", cell: (d) => <span className="font-mono text-[12px]">{fmtDateTime(d.createdAt)}</span> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (d) => (write ? <Button size="xs" variant="outline" onClick={() => link.open(d)}>{tr("Đưa vào chuỗi")}</Button> : null) },
  ];
  return (
    <>
      <PageHeader
        title={tr("Vụ sản xuất")}
        description={tr("Vụ gắn với một chuỗi cung ứng, vùng sản xuất đã hoàn tất hồ sơ và sản phẩm đang bán. Vụ nháp chưa thuộc chuỗi; khi đưa vào chuỗi, ảnh đã chụp được gắn vào vụ. Mọi bước ghi lên sổ truy xuất.")}
        actions={
          write && (
            <>
              <Button size="sm" variant="outline" onClick={() => router.push("/production-cycles/new")}>{tr("Lập vụ nháp")}</Button>
              <Button size="sm" onClick={() => add.open("cycle")}><Plus /> {tr("Tạo vụ")}</Button>
            </>
          )
        }
      />
      <PageBody>
        <div role="tablist" className="flex gap-1">
          {(["cycles", "drafts"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {k === "cycles" ? tr("Vụ trong chuỗi") : tr("Vụ nháp")} <span className="font-mono text-[11px] opacity-70">{k === "cycles" ? cycles.data?.length ?? "" : drafts.data?.length ?? ""}</span>
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          {tab === "cycles" ? (
            <DataTable rows={cycles.data} loading={cycles.isLoading} error={cycles.error} onRetry={() => cycles.refetch()} columns={cols} rowKey={(c) => c.id} empty={<EmptyState title={tr("Chưa có vụ sản xuất")} />} />
          ) : (
            <DataTable rows={drafts.data} loading={drafts.isLoading} error={drafts.error} onRetry={() => drafts.refetch()} columns={draftCols} rowKey={(d) => d.id} empty={<EmptyState title={tr("Không có vụ nháp")} />} />
          )}
        </div>
      </PageBody>
      <CycleSheet id={openId} view={view} onClose={() => {setOpenId(null);router.push("/production-cycles");}} options={options} />
      {view==="new" && write && <CreateDialog kind="draft" props={{open:true,onOpenChange:o=>{if(!o)router.push("/production-cycles");}}} options={options}/>}
      {view==="draft" && cycleId && drafts.data?.find(d=>d.id===cycleId) && <DraftDetails draft={drafts.data.find(d=>d.id===cycleId)!} onLink={d=>link.open(d)}/>}
      {add.target && (
        <CreateDialog kind={add.target} props={add.props} options={options} />
      )}
      {link.target && (
        <CommandDialog {...link.props} title={tr("Đưa vụ nháp vào chuỗi · {p0}", { p0: link.target.name })} endpoint="POST /production-cycles/drafts/:id/link" description={tr("Vụ nháp trở thành vụ trong chuỗi (giữ nguyên mã và ảnh đã chụp). Chuỗi phải đang hoạt động và có binding Fabric.")} schema={linkSchema} defaultValues={{ chainId: options.chains[0]?.id ?? "" }} version={link.target.version} submitLabel={tr("Đưa vào chuỗi")} invalidate={[["ws-cycles"], ["ws-cycle-drafts"]]} run={(v, cmd) => opsApi.linkDraft(link.target!.id, { chainId: v.chainId, version: link.target!.version }, cmd)}>
          {(f) => <SelectField control={f.control} name="chainId" label={tr("Chuỗi cung ứng")} options={options.chains.map((c) => ({ value: c.id, label: c.name }))} />}
        </CommandDialog>
      )}
    </>
  );
}

function CreateDialog({ kind, props, options }: { kind: "cycle" | "draft"; props: { open: boolean; onOpenChange: (o: boolean) => void }; options: Options }) {
  const common = { farmId: options.farms[0]?.id ?? "", productId: "", seedMaterialId: "", responsibleUserId: "", cultivationMethod: "", harvestUnit: "kg", maxHarvestQuantity: "" as const, note: "", plotId: "", name: "", startDate: "", plannedHarvest: "" };
  if (kind === "draft")
    return (
      <CommandDialog
        {...props}
        title={tr("Lập vụ nháp")}
        endpoint="POST /production-cycles/drafts"
        description={tr("Vụ nháp dùng để chuẩn bị khi chưa chọn chuỗi; mã vụ tự sinh nếu bỏ trống và không được trùng trong cùng vùng.")}
        schema={draftSchema}
        defaultValues={{ ...common, cycleCode: "", cultivatedArea: "" as unknown as number }}
        submitLabel={tr("Lưu nháp")}
        invalidate={[["ws-cycle-drafts"]]}
        wide
        run={(v, cmd) => opsApi.createDraft({ farmId: v.farmId, plotId: v.plotId, productId: v.productId, name: v.name, cycleCode: blank(v.cycleCode), cultivatedArea: v.cultivatedArea, startDate: v.startDate, plannedHarvest: v.plannedHarvest, harvestUnit: v.harvestUnit, maxHarvestQuantity: blank(v.maxHarvestQuantity) as number | undefined, seedMaterialId: blank(v.seedMaterialId), responsibleUserId: blank(v.responsibleUserId), cultivationMethod: blank(v.cultivationMethod), note: blank(v.note) }, cmd)}
      >
        {(f) => <CycleFields f={f as never} options={options} draft />}
      </CommandDialog>
    );
  return (
    <CommandDialog
      {...props}
      title={tr("Tạo vụ sản xuất")}
      endpoint="POST /production-cycles"
      description={tr("Vùng sản xuất và sản phẩm phải đã hoàn tất hồ sơ; giống phải là giống đang dùng của doanh nghiệp. Tổ chức cần vai sản xuất trong chuỗi đã chọn.")}
      schema={cycleSchema}
      defaultValues={{ ...common, chainId: options.chains[0]?.id ?? "", cycleCode: "", cultivatedArea: "" }}
      submitLabel={tr("Tạo vụ")}
      invalidate={[["ws-cycles"]]}
      wide
      run={(v, cmd) => opsApi.createCycle({ chainId: v.chainId, farmId: v.farmId, plotId: blank(v.plotId), productId: v.productId, cycleCode: v.cycleCode, name: blank(v.name), cultivatedArea: blank(v.cultivatedArea) as number | undefined, startDate: blank(v.startDate), plannedHarvest: blank(v.plannedHarvest), harvestUnit: v.harvestUnit, maxHarvestQuantity: blank(v.maxHarvestQuantity) as number | undefined, seedMaterialId: blank(v.seedMaterialId), responsibleUserId: blank(v.responsibleUserId), cultivationMethod: blank(v.cultivationMethod), note: blank(v.note) }, cmd)}
    >
      {(f) => <CycleFields f={f as never} options={options} />}
    </CommandDialog>
  );
}

function CycleFields({ f, options, draft }: { f: { control: never }; options: Options; draft?: boolean }) {
  const c = f.control;
  const farmId = useWatch({ control: c, name: "farmId" }) as string;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {!draft && <SelectField control={c} name="chainId" label={tr("Chuỗi cung ứng")} options={options.chains.map((x) => ({ value: x.id, label: x.name }))} />}
        <TextField control={c} name="name" label={draft ? tr("Tên vụ") : tr("Tên vụ (tùy chọn)")} max={255} />
        <TextField control={c} name="cycleCode" label={draft ? tr("Mã vụ (tùy chọn)") : tr("Mã vụ")} max={100} />
        <SelectField control={c} name="farmId" label={tr("Vùng sản xuất")} options={options.farms.map((x) => ({ value: x.id, label: x.name }))} />
        <SelectField control={c} name="plotId" label={draft ? tr("Thửa đất") : tr("Thửa đất (tùy chọn)")} options={options.plots.filter((p) => p.farmId === farmId).map((p) => ({ value: p.id, label: p.name }))} />
        <SelectField control={c} name="productId" label={tr("Sản phẩm")} options={options.products.map((p) => ({ value: p.id, label: p.productName }))} />
        <SelectField control={c} name="seedMaterialId" label={tr("Giống (tùy chọn)")} options={options.seeds.map((m) => ({ value: m.id, label: m.name }))} />
        <SelectField control={c} name="responsibleUserId" label={tr("Người phụ trách (tùy chọn)")} options={options.members.map((m) => ({ value: m.id, label: m.fullName }))} />
        <TextField control={c} name="cultivatedArea" label={draft ? tr("Diện tích canh tác (m²)") : tr("Diện tích canh tác (m², tùy chọn)")} type="number" />
        <TextField control={c} name="cultivationMethod" label={tr("Phương thức canh tác (tùy chọn)")} />
        <TextField control={c} name="startDate" label={draft ? tr("Ngày bắt đầu") : tr("Ngày bắt đầu (tùy chọn)")} type="date" />
        <TextField control={c} name="plannedHarvest" label={draft ? tr("Dự kiến thu hoạch") : tr("Dự kiến thu hoạch (tùy chọn)")} type="date" />
        <TextField control={c} name="harvestUnit" label={tr("Đơn vị thu hoạch")} />
        <TextField control={c} name="maxHarvestQuantity" label={tr("Sản lượng tối đa (tùy chọn)")} type="number" />
      </div>
      <TextAreaField control={c} name="note" label={tr("Ghi chú (tùy chọn)")} />
    </>
  );
}

function CycleSheet({ id, onClose, options,view }: { id: string | null; onClose: () => void; options: Options;view:string }) {
  const { user } = useSession();
  const router=useRouter();
  const now = useNow();
  const q = useQuery({ queryKey: ["ws-cycle", id], queryFn: () => opsApi.cycle(id!), enabled: !!id });
  const plant = useDialog();
  const care = useDialog();
  const harvest = useDialog();
  const close = useDialog();
  const cancel = useDialog();
  const c = q.data;
  const routeProps=(d:{props:{open:boolean;onOpenChange:(o:boolean)=>void}},part:string)=>({...d.props,open:d.props.open||view===part,onOpenChange:(o:boolean)=>{d.props.onOpenChange(o);if(!o&&["plant","journal-new","harvest-new"].includes(view))router.push(`/production-cycles/${id}`);}});
  const invalidate = [["ws-cycle", id], ["ws-cycles"], ["ws-lots"]];
  const active = c && ["PLANTED", "GROWING"].includes(c.currentState);
  const canEvidence=useWorkspaceAccess().can("evidence.manage");
  const nowLocal = isoToLocal(new Date(now).toISOString());
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!c ? (
          q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{c.name ?? c.cycleCode}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{c.cycleCode}</span> · {c.product.productName} · v{c.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <nav className="flex flex-wrap gap-3 text-sm text-brand">{[["",tr("Tổng quan")],["journal",tr("Nhật ký")],["harvest",tr("Thu hoạch")]].map(([part,label])=><Link key={part} href={`/production-cycles/${c.id}${part?"/"+part:""}`}>{label}</Link>)}</nav>
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={CYCLE_STATE_TONE[c.currentState]}>{CYCLE_STATE_LABEL[c.currentState]}</Badge>
                {!c.canWriteProduction && <Badge tone="neutral" dot={false}>{tr("Chỉ xem")}</Badge>}
              </div>
              {c.canWriteProduction && ["CREATED", "PLANTED", "GROWING"].includes(c.currentState) && (
                <div className="flex flex-wrap gap-2">
                  {c.currentState === "CREATED" && <Button size="sm" onClick={() => plant.open(true)}>{tr("Xuống giống")}</Button>}
                  {active && <Button size="sm" onClick={() => care.open(true)}>{tr("Ghi nhật ký chăm sóc")}</Button>}
                  {active && <Button size="sm" variant="outline" onClick={() => harvest.open(true)}>{tr("Thu hoạch")}</Button>}
                  {active && <Button size="sm" variant="outline" onClick={() => close.open(true)}>{tr("Kết thúc vụ")}</Button>}
                  <Button size="sm" variant="ghost" className="text-danger" onClick={() => cancel.open(true)}>{tr("Hủy vụ")}</Button>
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Vùng / thửa"), `${c.farm.name}${c.plot ? ` · ${c.plot.name}` : ""}`],
                  [tr("Ngày bắt đầu"), fmtDate(c.startDate)],
                  [tr("Xuống giống lúc"), c.plantedAt && fmtDateTime(c.plantedAt)],
                  [tr("Dự kiến thu hoạch"), fmtDate(c.plannedHarvest)],
                  [tr("Diện tích canh tác"), c.cultivatedArea && `${fmtNumber(c.cultivatedArea)} m²`],
                  [tr("Đã thu hoạch"), `${fmtNumber(sumQuantities(c.harvestEvents.map(h=>h.quantity)))} ${c.harvestUnit}${c.maxHarvestQuantity ? ` / ${fmtNumber(c.maxHarvestQuantity)}` : ""}`],
                  [tr("Phương thức canh tác"), c.cultivationMethod],
                  [tr("Giống"), options.seeds.find((m) => m.id === c.seedMaterialId)?.name ?? (c.seedMaterialId ? c.seedMaterialId.slice(0, 8) : null)],
                  [tr("Người phụ trách"), options.members.find((m) => m.id === c.responsibleUserId)?.fullName ?? (c.responsibleUserId ? c.responsibleUserId.slice(0, 8) : null)],
                  [tr("Ghi chú"), c.note],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
              </dl>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Nhật ký chăm sóc")} <span className="font-mono text-[11.5px] font-normal text-ink-2">{c.careRecords.length}</span></h3>
                {c.careRecords.length ? (
                  <ol className="flex flex-col gap-2">
                    {c.careRecords.map((r) => (
                      <li key={r.id} className="rounded-md border border-line px-3 py-2 text-[13px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{r.name}</span>
                          <Badge tone="neutral" dot={false}>{CARE_TYPE_LABEL[r.careType] ?? r.careType}</Badge>
                          <span className="ml-auto font-mono text-[11.5px] text-ink-2">{fmtDateTime(r.eventTime)}</span>
                        </div>
                        <p className="mt-1 text-[12.5px] text-ink-2">
                          {[r.materialName, r.quantity && `${fmtNumber(r.quantity)} ${r.unit ?? ""}`, r.applicationArea, r.withdrawalPeriod !== null && tr("cách ly {p0} ngày", { p0: r.withdrawalPeriod }), r.cropCondition].filter(Boolean).join(" · ")}
                        </p>
                        <p className="font-mono text-[11px] text-ink-2">{r.journalCode} · {r.evidenceIds.length} {tr("ảnh")}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <EmptyState title={tr("Chưa có nhật ký")} />
                )}
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Thu hoạch & lô")} <span className="font-mono text-[11.5px] font-normal text-ink-2">{c.harvestEvents.length}</span></h3>
                {c.harvestEvents.length ? (
                  <ul className="divide-y divide-line/70 rounded-md border border-line">
                    {c.harvestEvents.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                        <span className="font-mono text-[12px]">{x.harvestCode}</span>
                        <span>{fmtNumber(x.quantity)} {x.unit}</span>
                        <span className="text-ink-2">{fmtDateTime(x.harvestTime)}</span>
                        {x.lot && (
                          <Link href={`/lots/${x.lot.id}`} className="ml-auto text-brand-ink underline underline-offset-2">
                            {x.lot.lotCode} · {LOT_STATE_LABEL[x.lot.currentState] ?? x.lot.currentState}
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={tr("Chưa thu hoạch")} />
                )}
              </section>
              <section className="flex flex-col gap-2"><h3 className="text-sm font-semibold">{tr("Cửa sổ cảm biến")}</h3>{c.harvestEvents.map(h=><Callout key={h.id} tone="info">{h.harvestCode} · {h.sensorWindow?`${fmtDateTime(h.sensorWindow.periodStart)} → ${fmtDateTime(h.sensorWindow.periodEnd)}`:tr("Chưa có cửa sổ")}</Callout>)}<p className="text-xs text-ink-2">{c.sensorReadings.length} {tr("bản ghi")} · {c.sensorDigests.length} {tr("digest")}</p></section>
              <EvidencePanel entityType="CYCLE" entityId={c.id} canManage={!!c.canWriteProduction && canEvidence && c.currentState !== "CANCELLED"} title={tr("Ảnh vụ sản xuất")} />
            </div>

            {c.canWriteProduction && (plant.target || view==="plant") && c.currentState==="CREATED" && (
              <CommandDialog {...routeProps(plant,"plant")} title={tr("Xuống giống · {p0}", { p0: c.cycleCode })} endpoint="POST /production-cycles/:id/plant" description={tr("Mốc trồng là mốc bắt đầu cửa sổ dữ liệu cảm biến và là giới hạn sớm nhất của nhật ký chăm sóc. Không được ở tương lai.")} schema={plantSchema} defaultValues={{ plantedAt: nowLocal }} version={c.version} submitLabel={tr("Ghi xuống giống")} invalidate={invalidate} run={(v, cmd) => opsApi.plant(c.id, { version: c.version, plantedAt: localToIso(v.plantedAt)! }, cmd)}>
                {(f) => <TextField control={f.control} name="plantedAt" label={tr("Thời điểm trồng")} type="datetime-local" />}
              </CommandDialog>
            )}
            {c.canWriteProduction && active && (care.target || view==="journal-new") && (
              <CommandDialog
                {...routeProps(care,"journal-new")}
                title={tr("Ghi nhật ký chăm sóc")}
                endpoint="POST /production-cycles/:id/care"
                description={tr("Cần 1–5 ảnh nhật ký hiện hành của vụ (tải ở khối Ảnh vụ sản xuất, loại Ảnh nhật ký chăm sóc). Vật tư chọn từ danh mục phải còn hạn tại ngày dùng; thời gian cách ly lấy theo danh mục.")}
                schema={careSchema}
                defaultValues={{ name: "", careType: CARE_TYPES[0], eventTime: nowLocal, materialId: "", materialName:"",activeIngredient:"",withdrawalPeriod:"",performerUserId:c.responsibleUserId??user?.id??"",quantity: "", unit: "", applicationArea: "", method: "", cropCondition: "", note: "", images: [] }}
                version={c.version}
                wide
                submitLabel={tr("Ghi nhật ký")}
                invalidate={invalidate}
                run={(v, cmd) => opsApi.care(c.id, { version: c.version, name: v.name, careType: v.careType, eventTime: localToIso(v.eventTime)!, evidenceRef: v.images[0], additionalEvidenceRefs: additionalEvidence(v.images.slice(1)), materialId: blank(v.materialId),materialName:blank(v.materialName),activeIngredient:blank(v.activeIngredient),withdrawalPeriod:typeof v.withdrawalPeriod==="number"?v.withdrawalPeriod:undefined,performerUserId:blank(v.performerUserId), quantity: blank(v.quantity) as number | undefined, unit: blank(v.unit), applicationArea: blank(v.applicationArea), method: blank(v.method), cropCondition: blank(v.cropCondition), note: blank(v.note) }, cmd)}
              >
                {(f) => (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField control={f.control} name="name" label={tr("Công việc")} max={255} />
                      <SelectField control={f.control} name="careType" label={tr("Loại công việc")} options={CARE_TYPES.map((t) => ({ value: t, label: CARE_TYPE_LABEL[t] }))} />
                      <TextField control={f.control} name="eventTime" label={tr("Thời điểm thực hiện")} type="datetime-local" />
                      <SelectField control={f.control} name="materialId" label={tr("Vật tư sử dụng (tùy chọn)")} options={options.inputs.map((m) => ({ value: m.id, label: `${m.name} (${m.unit})` }))} />
                      <TextField control={f.control} name="quantity" label={tr("Lượng (tùy chọn)")} type="number" />
                      <TextField control={f.control} name="unit" label={tr("Đơn vị (khớp danh mục vật tư)")} />
                      <TextField control={f.control} name="applicationArea" label={tr("Khu vực áp dụng (tùy chọn)")} />
                      <TextField control={f.control} name="method" label={tr("Cách thực hiện (tùy chọn)")} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2"><TextField control={f.control} name="materialName" label={tr("Tên vật tư (khi không chọn danh mục)")}/><TextField control={f.control} name="activeIngredient" label={tr("Hoạt chất (tùy chọn)")}/><TextField control={f.control} name="withdrawalPeriod" type="number" label={tr("Thời gian cách ly (ngày)")}/><SelectField control={f.control} name="performerUserId" label={tr("Người thực hiện")} options={options.members.filter(m=>m.id===user?.id||m.id===c.responsibleUserId).map(m=>({value:m.id,label:m.fullName}))}/></div>
                    <TextField control={f.control} name="cropCondition" label={tr("Tình trạng cây trồng (tùy chọn)")} max={500} />
                    <EvidencePick control={f.control} name="images" label={tr("Ảnh nhật ký")} entityType="CYCLE" entityId={c.id} kind="CARE_IMAGE" />
                    <TextAreaField control={f.control} name="note" label={tr("Ghi chú (tùy chọn)")} />
                  </>
                )}
              </CommandDialog>
            )}
            {c.canWriteProduction && active && (harvest.target || view==="harvest-new") && (
              <CommandDialog
                {...routeProps(harvest,"harvest-new")}
                title={tr("Thu hoạch và tạo lô")}
                endpoint="POST /production-cycles/:cycleId/harvests"
                description={tr("Mỗi lần thu hoạch tạo một lô kèm mã QR truy xuất. Người đại diện là người phụ trách vụ (hoặc tài khoản đang ghi khi vụ chưa phân công). Tổng sản lượng không vượt sản lượng tối đa của vụ.")}
                schema={harvestSchema}
                defaultValues={{ lotName: "", lotCode: "", harvestTime: nowLocal, quantity: "" as unknown as number, unit: c.harvestUnit ?? c.product.defaultUnit ?? "kg", grade: "", harvestArea: "", harvestMethod: "", qualityNote: "", packageCount: "", packaging: "", packedAt: "", expiryDate: "", initialStorageSiteId: "", note: "", images: [], lotImage: [] }}
                version={c.version}
                wide
                submitLabel={tr("Ghi thu hoạch")}
                invalidate={invalidate}
                run={(v, cmd) =>
                  opsApi.harvest(c.id, { version: c.version, lotName: v.lotName, lotCode: blank(v.lotCode), representativeUserId: c.responsibleUserId ?? user!.id, evidenceRef: v.images[0], additionalEvidenceRefs: additionalEvidence(v.images.slice(1)), lotImageEvidenceRef: v.lotImage[0], harvestTime: localToIso(v.harvestTime)!, quantity: v.quantity, unit: v.unit, grade: blank(v.grade), harvestArea: blank(v.harvestArea), harvestMethod: blank(v.harvestMethod), qualityNote: blank(v.qualityNote), packageCount: blank(v.packageCount) as number | undefined, packaging: blank(v.packaging), packedAt: blank(v.packedAt), expiryDate: blank(v.expiryDate), initialStorageSiteId: blank(v.initialStorageSiteId), note: blank(v.note) }, cmd)
                }
              >
                {(f) => (
                  <>
                    <Callout tone="info">{tr("Người đại diện")}: {options.members.find((m) => m.id === (c.responsibleUserId ?? user?.id))?.fullName ?? user?.fullName}</Callout>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField control={f.control} name="lotName" label={tr("Tên lô")} max={255} />
                      <TextField control={f.control} name="lotCode" label={tr("Mã lô (tùy chọn, tự sinh)")} max={120} />
                      <TextField control={f.control} name="harvestTime" label={tr("Thời điểm thu hoạch")} type="datetime-local" />
                      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                        <TextField control={f.control} name="quantity" label={tr("Sản lượng")} type="number" />
                        <TextField control={f.control} name="unit" label={tr("Đơn vị")} />
                      </div>
                      <TextField control={f.control} name="grade" label={tr("Phân loại (tùy chọn)")} />
                      <TextField control={f.control} name="harvestArea" label={tr("Khu vực thu hoạch (tùy chọn)")} />
                      <TextField control={f.control} name="packageCount" label={tr("Số kiện (tùy chọn)")} type="number" />
                      <TextField control={f.control} name="packaging" label={tr("Quy cách đóng gói (tùy chọn)")} />
                      <TextField control={f.control} name="packedAt" label={tr("Ngày đóng gói (tùy chọn)")} type="date" />
                      <TextField control={f.control} name="expiryDate" label={tr("Hạn sử dụng (tùy chọn)")} type="date" />
                      <SelectField control={f.control} name="initialStorageSiteId" label={tr("Cơ sở lưu giữ ban đầu (tùy chọn)")} options={options.sites.map((s) => ({ value: s.id, label: s.name }))} />
                      <TextField control={f.control} name="harvestMethod" label={tr("Cách thu hoạch (tùy chọn)")} />
                    </div>
                    <EvidencePick control={f.control} name="images" label={tr("Ảnh thu hoạch")} entityType="CYCLE" entityId={c.id} kind="HARVEST_IMAGE" />
                    <EvidencePick control={f.control} name="lotImage" label={tr("Ảnh lô hàng")} entityType="CYCLE" entityId={c.id} kind="LOT_IMAGE" min={1} max={1} />
                    <TextAreaField control={f.control} name="qualityNote" label={tr("Ghi chú chất lượng (tùy chọn)")} /><TextAreaField control={f.control} name="note" label={tr("Ghi chú (tùy chọn)")} />
                  </>
                )}
              </CommandDialog>
            )}
            {close.target && (
              <CommandDialog {...close.props} title={tr("Kết thúc vụ · {p0}", { p0: c.cycleCode })} endpoint="POST /production-cycles/:id/close" description={tr("Sau khi kết thúc, vụ không nhận nhật ký hay thu hoạch mới. Lô đã tạo vẫn lưu thông bình thường.")} schema={emptySchema} defaultValues={{}} version={c.version} submitLabel={tr("Kết thúc vụ")} invalidate={invalidate} run={(_, cmd) => opsApi.close(c.id, { version: c.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {cancel.target && (
              <CommandDialog {...cancel.props} title={tr("Hủy vụ · {p0}", { p0: c.cycleCode })} endpoint="POST /production-cycles/:id/cancel" description={tr("Hủy là cuối cùng và được ghi lên sổ truy xuất kèm lý do.")} schema={cancelSchema} defaultValues={{ reason: "" }} version={c.version} tone="danger" submitLabel={tr("Hủy vụ")} invalidate={invalidate} run={(v, cmd) => opsApi.cancel(c.id, { version: c.version, reason: v.reason }, cmd)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={500} />}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DraftDetails({draft,onLink}:{draft:CycleDraft;onLink:(d:CycleDraft)=>void}){const {can}=useWorkspaceAccess();return <PageBody><h2 className="text-lg font-semibold">{draft.name}</h2><p className="font-mono text-sm">{draft.cycleCode} · v{draft.version}</p>{can("production.write")&&<Button onClick={()=>onLink(draft)}>{tr("Đưa vào chuỗi")}</Button>}<EvidencePanel entityType="CYCLE_DRAFT" entityId={draft.id} canManage={can("production.write")&&can("evidence.manage")}/></PageBody>;}
