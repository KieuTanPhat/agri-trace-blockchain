"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery,useLedgerQueryClient as useQueryClient} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import { Controller, type Control } from "react-hook-form";
import { z } from "zod";
import { Plus } from "lucide-react";
import { wapi, type FarmInput } from "@/lib/ledger/resource-api";
import type { Farm, Material, Plot, Site } from "@/lib/ledger/resource-types";
import {useAuth} from "@/lib/auth-store";
import {FilterSelect} from "@/components/ledger/kit/filters";
import { fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";

const REQUIRED = ["AREA_IMAGE", "LAND_CERTIFICATE", "PRODUCTION_CONTRACT", "QUALITY_CERTIFICATE", "INSPECTION_IMAGE"].map((kind) => ({ kind, min: 1 }));
const opt = (max: number) => z.string().trim().max(max).optional();
// FarmDto (catalog/catalog.module.ts)
const farmSchema = z.object({
  name: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  kind: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(100),
  region: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
  address: z.string().trim().min(5, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 5 }) }).max(500),
  areaM2: z.coerce.number<number>({ error: () => tr("Nhập số") }).positive({ error: () => tr("Phải là số dương") }),
  expectedOutput: z.coerce.number<number>({ error: () => tr("Nhập số") }).positive({ error: () => tr("Phải là số dương") }),
  outputUnit: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(30),
  privacy: z.enum(["PRIVATE", "PUBLIC"]),
  representative: opt(255),
  phone: opt(30),
  email: z.union([z.literal(""), z.email({ error: () => tr("Email không hợp lệ") })]).optional(),
  cropCode: opt(100),
  otherInfo: opt(2000),
  seedMaterialIds: z.array(z.string()).max(50),
  inputMaterialIds: z.array(z.string()).max(50),
  linkedSiteId: z.string().optional(),
});
// PlotDto
const plotSchema = z.object({
  name: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  area: z.union([z.literal(""), z.coerce.number<number>().positive({ error: () => tr("Phải là số dương") })]).optional(),
  unit: opt(30),
  location: opt(500),
});
const emptySchema = z.object({});
const blank = <V,>(v: V) => (v === "" || v === undefined || v === null ? undefined : v);

export default function AreasPage({view="list",resourceId,farmId}:{view?:"list"|"new"|"detail"|"plot";resourceId?:string;farmId?:string}) {
  const router=useRouter();
  const { can, primary } = useWorkspaceAccess();
  const overview = useOverview().data;
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(resourceId ?? farmId ?? null);
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog, enabled: can("catalog.read") });
  const materials = useQuery({ queryKey: ["ws-materials"], queryFn: wapi.materials, enabled: can("materials.read") });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("sites.read") });
  const add = useDialog();
  const farmCapable = overview?.organization.capabilities.includes("FARM") ?? true;
  if (!can("catalog.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền catalog.read"))} />;
  const farms = catalog.data?.farms;
  const plots = catalog.data?.plots ?? [];
  const selectedId=openId ?? (view==="plot"?farms?.find(f=>f.status==="ACTIVE")?.id:undefined);
  const columns: Column<Farm>[] = [
    { key: "name", header: tr("Vùng sản xuất"), sort: (f) => f.name, cell: (f) => <span className="flex flex-col"><span className="font-medium">{f.name}</span><span className="font-mono text-[11px] text-ink-2">{f.internalCode}</span></span> },
    { key: "kind", header: tr("Loại hình"), cell: (f) => <span className="text-[12.5px]">{f.kind}</span> },
    { key: "region", header: tr("Khu vực"), hideBelow: "md", cell: (f) => <span className="text-ink-2">{f.region}</span> },
    { key: "area", header: tr("Diện tích / sản lượng"), hideBelow: "lg", cell: (f) => <span className="font-mono text-[12px]">{fmtNumber(f.areaM2)} m² · {fmtNumber(f.expectedOutput)} {f.outputUnit}</span> },
    { key: "plots", header: tr("Lô đất"), hideBelow: "md", cell: (f) => <span className="font-mono text-[12px]">{plots.filter((p) => p.farmId === f.id).length}</span> },
    { key: "ev", header: tr("Hồ sơ"), cell: (f) => (f.evidenceComplete ? <Badge tone="ok">{tr("Đủ")}</Badge> : <Badge tone="warn">{tr("Thiếu")}</Badge>) },
    { key: "status", header: tr("Trạng thái"), cell: (f) => <Badge tone={f.status === "ACTIVE" ? "ok" : "neutral"}>{f.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (f) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/areas/${f.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  const mats = materials.data ?? [];
  return (
    <>
      <PageHeader
        title={tr("Vùng sản xuất")}
        description={tr("Vùng trồng và lô đất của doanh nghiệp. Vùng mới ở trạng thái ngừng; cần đủ năm loại ảnh/chứng từ (ảnh vùng, quyền sử dụng đất, hợp đồng sản xuất, chứng nhận chất lượng, ảnh kiểm tra) rồi hoàn tất để đưa vào hoạt động và gắn sản phẩm.")}
        actions={can("catalog.manage") && farmCapable && <Button size="sm" onClick={() => router.push("/enterprise/areas/new")}><Plus /> {tr("Thêm vùng sản xuất")}</Button>}
      />
      <PageBody className="min-w-0">
        {view==="plot" && <FilterSelect label={tr("Vùng sản xuất")} value={selectedId ?? ""} onChange={setOpenId} options={(farms??[]).filter(f=>f.status==="ACTIVE").map(f=>({value:f.id,label:f.name}))}/>}
        {!farmCapable && <Callout tone="info">{tr("Chỉ tổ chức có năng lực sản xuất (FARM) đang hoạt động mới tạo vùng sản xuất.")}</Callout>}
        {!primary && <Callout>{tr("Bạn chỉ thấy vùng sản xuất nằm trong phạm vi nhóm quyền được gán.")}</Callout>}
        <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={farms} loading={catalog.isLoading} error={catalog.error} onRetry={() => catalog.refetch()} columns={columns} rowKey={(f) => f.id} empty={<EmptyState title={tr("Chưa có vùng sản xuất")} />} />
        </div>
      </PageBody>
      <FarmSheet initialPlot={view==="plot"} farm={farms?.find((f) => f.id === selectedId) ?? null} plots={plots.filter((p) => p.farmId === selectedId)} materials={mats} sites={sites.data ?? []} onClose={() => {setOpenId(null);router.push("/enterprise/areas");}} canManage={can("catalog.manage")} canEvidence={can("catalog.manage") && can("evidence.manage")} />
      <CommandDialog
        {...add.props}
        open={view==="new" && can("catalog.manage") && farmCapable}
        onOpenChange={o=>{if(!o)router.push("/enterprise/areas");}}
        onDone={()=>router.push("/enterprise/areas")}
        title={tr("Thêm vùng sản xuất")}
        endpoint="POST /catalog/farms"
        description={tr("Mã nội bộ do hệ thống sinh. Giống và vật tư chọn từ danh mục của doanh nghiệp; nhà xưởng liên kết phải là cơ sở đang hoạt động.")}
        schema={farmSchema}
        defaultValues={{ name: "", kind: "", region: "", address: "", areaM2: "" as unknown as number, expectedOutput: "" as unknown as number, outputUnit: "kg", privacy: "PRIVATE", representative: "", phone: "", email: "", cropCode: "", otherInfo: "", seedMaterialIds: [], inputMaterialIds: [], linkedSiteId: "" }}
        submitLabel={tr("Thêm")}
        invalidate={[["ws-catalog"]]}
        wide
        run={(v, cmd) => {
          const body: FarmInput = { organizationId: user!.organizationId!, location:v.address, name: v.name, kind: v.kind, region: v.region, address: v.address, areaM2: v.areaM2, expectedOutput: v.expectedOutput, outputUnit: v.outputUnit, privacy: v.privacy, representative: blank(v.representative), phone: blank(v.phone), email: blank(v.email), cropCode: blank(v.cropCode), otherInfo: blank(v.otherInfo), seedMaterialIds: v.seedMaterialIds, inputMaterialIds: v.inputMaterialIds, linkedSiteId: blank(v.linkedSiteId) };
          return wapi.createFarm(body, cmd);
        }}
      >
        {(f) => (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={f.control} name="name" label={tr("Tên vùng")} max={255} />
              <TextField control={f.control} name="kind" label={tr("Loại hình (ví dụ: Cây ăn quả)")} />
            </div>
            <TextField control={f.control} name="address" label={tr("Địa chỉ")} max={500} />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={f.control} name="region" label={tr("Khu vực")} />
              <TextField control={f.control} name="cropCode" label={tr("Mã vùng trồng (tùy chọn)")} />
              <TextField control={f.control} name="areaM2" label={tr("Diện tích (m²)")} type="number" />
              <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                <TextField control={f.control} name="expectedOutput" label={tr("Sản lượng dự kiến")} type="number" />
                <TextField control={f.control} name="outputUnit" label={tr("Đơn vị")} />
              </div>
              <TextField control={f.control} name="representative" label={tr("Người đại diện (tùy chọn)")} />
              <TextField control={f.control} name="phone" label={tr("Điện thoại (tùy chọn)")} />
              <TextField control={f.control} name="email" label={tr("Email (tùy chọn)")} />
              <SelectField control={f.control} name="linkedSiteId" label={tr("Nhà xưởng liên kết (tùy chọn)")} options={(sites.data ?? []).filter((s) => s.status === "ACTIVE").map((s) => ({ value: s.id, label: s.name }))} />
            </div>
            <ChoiceField control={f.control} name="privacy" label={tr("Hiển thị")} options={[{ value: "PRIVATE", label: tr("Riêng tư"), help: tr("Chỉ doanh nghiệp xem") }, { value: "PUBLIC", label: tr("Công khai"), help: tr("Có thể hiện trên trang truy xuất") }]} />
            <MaterialChecks control={f.control as never} name="seedMaterialIds" label={tr("Giống sử dụng")} options={mats.filter((m) => m.kind === "SEED")} />
            <MaterialChecks control={f.control as never} name="inputMaterialIds" label={tr("Vật tư đầu vào")} options={mats.filter((m) => m.kind !== "SEED")} />
            <TextAreaField control={f.control} name="otherInfo" label={tr("Thông tin khác (tùy chọn)")} max={2000} />
          </>
        )}
      </CommandDialog>
    </>
  );
}

function MaterialChecks({ control, name, label, options }: { control: Control<Record<string, string[]>>; name: string; label: string; options: Material[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-[13px] font-medium">{label}</legend>
          {options.length ? (
            options.map((m) => (
              <label key={m.id} className="flex items-center gap-2 text-[13px]">
                <Checkbox checked={field.value.includes(m.id)} onCheckedChange={(c) => field.onChange(c ? [...field.value, m.id] : field.value.filter((x) => x !== m.id))} />
                {m.name} <span className="font-mono text-[11px] text-ink-2">{m.code}</span>
                {m.status !== "ACTIVE" && <Badge tone="neutral" dot={false}>{tr("Ngừng")}</Badge>}
              </label>
            ))
          ) : (
            <span className="text-[12.5px] text-ink-2">{tr("Chưa có mục phù hợp trong Giống & vật tư.")}</span>
          )}
        </fieldset>
      )}
    />
  );
}

function FarmSheet({ farm, plots, materials, sites, onClose, canManage, canEvidence,initialPlot }: {initialPlot:boolean; farm: Farm | null; plots: Plot[]; materials: Material[]; sites: Site[]; onClose: () => void; canManage: boolean; canEvidence: boolean }) {
  const router=useRouter();
  const qc = useQueryClient();
  const complete = useDialog();
  const addPlot = useDialog();
  const f = farm;
  const name = (ids: string[]) => ids.map((id) => materials.find((m) => m.id === id)?.name ?? id.slice(0, 8)).join(", ");
  return (
    <Sheet open={!!f} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {f && (
          <>
            <SheetHeader>
              <SheetTitle>{f.name}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{f.internalCode}</span> · {f.kind} · v{f.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={f.status === "ACTIVE" ? "ok" : "neutral"}>{f.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge>
                {f.evidenceComplete ? <Badge tone="ok">{tr("Hồ sơ ảnh đã hoàn tất")}</Badge> : <Badge tone="warn">{tr("Chưa hoàn tất hồ sơ ảnh")}</Badge>}
                <Badge tone="neutral" dot={false}>{f.privacy === "PUBLIC" ? tr("Công khai") : tr("Riêng tư")}</Badge>
              </div>
              {canManage && !f.evidenceComplete && (
                <div>
                  <Button size="sm" onClick={() => complete.open(true)}>{tr("Hoàn tất hồ sơ ảnh")}</Button>
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Địa chỉ"), f.address],
                  [tr("Khu vực"), f.region],
                  [tr("Diện tích"), f.areaM2 && `${fmtNumber(f.areaM2)} m²`],
                  [tr("Sản lượng dự kiến"), f.expectedOutput && `${fmtNumber(f.expectedOutput)} ${f.outputUnit ?? ""}`],
                  [tr("Mã vùng trồng"), f.cropCode],
                  [tr("Người đại diện"), f.representative],
                  [tr("Điện thoại"), f.phone],
                  ["Email", f.email],
                  [tr("Giống sử dụng"), f.seedMaterialIds.length ? name(f.seedMaterialIds) : null],
                  [tr("Vật tư đầu vào"), f.inputMaterialIds.length ? name(f.inputMaterialIds) : null],
                  [tr("Nhà xưởng liên kết"), f.linkedSiteId ? sites.find((s) => s.id === f.linkedSiteId)?.name ?? f.linkedSiteId : null],
                  [tr("Thông tin khác"), f.otherInfo],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
              <section className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Lô đất")}</h3>
                  <span className="font-mono text-[11.5px] text-ink-2">{plots.length}</span>
                  {canManage && f.status === "ACTIVE" && (
                    <Button size="xs" variant="outline" className="ml-auto" onClick={() => router.push(`/enterprise/areas/plots/new?farmId=${f.id}`)}>
                      <Plus /> {tr("Thêm lô đất")}
                    </Button>
                  )}
                </div>
                {f.status !== "ACTIVE" && <p className="text-[12.5px] text-ink-2">{tr("Chỉ thêm lô đất cho vùng sản xuất đang hoạt động.")}</p>}
                {plots.length ? (
                  <ul className="divide-y divide-line/70 rounded-md border border-line">
                    {plots.map((p) => (
                      <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-[13px]">
                        <span className="flex-1">{p.name}</span>
                        <span className="font-mono text-[12px] text-ink-2">{p.area ? `${fmtNumber(p.area)} ${p.unit ?? ""}` : "—"}</span>
                        <span className="hidden font-mono text-[11px] text-ink-2 sm:inline">{fmtDateTime(p.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title={tr("Chưa có lô đất")} />
                )}
              </section>
              <EvidencePanel entityType="FARM" entityId={f.id} canManage={canEvidence} required={REQUIRED} onChanged={() => qc.invalidateQueries({ queryKey: ["ws-catalog"] })} />
            </div>
            {complete.target && (
              <CommandDialog {...complete.props} title={tr("Hoàn tất hồ sơ ảnh · {p0}", { p0: f.name })} endpoint={`POST /catalog/farms/${f.id}/complete`} description={tr("Cần đủ năm loại ảnh/chứng từ bắt buộc. Hoàn tất sẽ đưa vùng vào hoạt động.")} schema={emptySchema} defaultValues={{}} version={f.version} submitLabel={tr("Hoàn tất")} invalidate={[["ws-catalog"]]} run={(_, cmd) => wapi.completeFarm(f.id, { version: f.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {canManage && f.status==="ACTIVE" && (initialPlot || addPlot.target) && (
              <CommandDialog {...addPlot.props} open={initialPlot || addPlot.props.open} onOpenChange={o=>{addPlot.props.onOpenChange(o);if(!o && initialPlot)router.push(`/enterprise/areas/${f.id}`);}} title={tr("Thêm lô đất · {p0}", { p0: f.name })} endpoint="POST /catalog/plots" description={tr("Tên lô đất không trùng trong cùng vùng sản xuất.")} schema={plotSchema} defaultValues={{ name: "", area: "", unit: "m2", location: "" }} submitLabel={tr("Thêm")} invalidate={[["ws-catalog"]]} run={(v, cmd) => wapi.createPlot({ farmId: f.id, name: v.name, area: blank(v.area) as number | undefined, unit: blank(v.unit), location: blank(v.location) }, cmd)}>
                {(form) => (
                  <>
                    <TextField control={form.control} name="name" label={tr("Tên lô đất")} max={255} />
                    <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                      <TextField control={form.control} name="area" label={tr("Diện tích (tùy chọn)")} type="number" />
                      <TextField control={form.control} name="unit" label={tr("Đơn vị")} />
                    </div>
                    <TextField control={form.control} name="location" label={tr("Vị trí (tùy chọn)")} />
                  </>
                )}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
