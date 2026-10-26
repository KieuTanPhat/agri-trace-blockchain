"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery,useLedgerQueryClient as useQueryClient} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import { z } from "zod";
import { Plus } from "lucide-react";
import { wapi, type MaterialInput } from "@/lib/ledger/resource-api";
import type { Material } from "@/lib/ledger/resource-types";
import { fmtDate, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { ChoiceField, SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { ReferenceSelectField } from "@/components/ledger/kit/reference-select";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { RevisionHistory } from "@/components/ledger/workspace/revision-history";

export const MATERIAL_KIND_LABEL: Record<string, string> = localized({ SEED: "Giống", FERTILIZER: "Phân bón", PROTECTION: "Thuốc bảo vệ thực vật", OTHER: "Vật tư khác" });
const opt = (max: number) => z.string().trim().max(max).optional();
const optNum = z.union([z.literal(""), z.coerce.number<number>().min(0, { error: () => tr("≥ 0") })]).optional();
// MaterialInput (enterprise-workspace/resources.dto.ts)
const fields = {
  code: opt(100),
  name: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
  kind: z.enum(["SEED", "FERTILIZER", "PROTECTION", "OTHER"]),
  unit: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(30),
  seedType: opt(100),
  supplier: opt(255),
  batchCode: opt(100),
  activeIngredient: opt(255),
  price: optNum,
  origin: opt(255),
  manufacturer: opt(255),
  description: opt(2000),
  withdrawalDays: z.union([z.literal(""), z.coerce.number<number>().int().min(0).max(3650, { error: () => tr("0–3650 ngày") })]).optional(),
  expiryDate: z.string().optional(),
};
const seedRule = (v: { kind: string; seedType?: string }) => v.kind !== "SEED" || (v.seedType ?? "").trim().length >= 2;
const createSchema = z.object(fields).refine(seedRule, { path: ["seedType"], error: () => tr("Giống cần khai loại giống (2–100 ký tự)") });
const reviseSchema = z
  .object({ ...fields, status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000) })
  .refine(seedRule, { path: ["seedType"], error: () => tr("Giống cần khai loại giống (2–100 ký tự)") });
const emptySchema = z.object({});
type Values = z.infer<typeof createSchema>;

const blank = <V,>(v: V) => (v === "" || v === undefined || v === null ? undefined : v);
function toInput(v: Values): MaterialInput {
  return {
    code: blank(v.code),
    name: v.name,
    kind: v.kind,
    unit: v.unit,
    seedType: v.kind === "SEED" ? blank(v.seedType) : undefined,
    supplier: blank(v.supplier),
    batchCode: blank(v.batchCode),
    activeIngredient: blank(v.activeIngredient),
    price: blank(v.price) as number | undefined,
    origin: blank(v.origin),
    manufacturer: blank(v.manufacturer),
    description: blank(v.description),
    withdrawalDays: blank(v.withdrawalDays) as number | undefined,
    expiryDate: blank(v.expiryDate),
  };
}
const fromRow = (m: Material): Values => ({
  code: m.code,
  name: m.name,
  kind: fields.kind.parse(m.kind),
  unit: m.unit,
  seedType: m.seedType ?? "",
  supplier: m.supplier ?? "",
  batchCode: m.batchCode ?? "",
  activeIngredient: m.activeIngredient ?? "",
  price: m.price !== null ? Number(m.price) : "",
  origin: m.origin ?? "",
  manufacturer: m.manufacturer ?? "",
  description: m.description ?? "",
  withdrawalDays: m.withdrawalDays ?? "",
  expiryDate: m.expiryDate?.slice(0, 10) ?? "",
});

export default function MaterialsPage({view="list",resourceId}:{view?:"list"|"new"|"detail";resourceId?:string}) {
  const router=useRouter();
  const { can } = useWorkspaceAccess();
  const overview = useOverview().data;
  const [kind, setKind] = useState("");
  const [openId, setOpenId] = useState<string | null>(resourceId ?? null);
  const q = useQuery({ queryKey: ["ws-materials"], queryFn: wapi.materials, enabled: can("materials.read") });
  const add = useDialog();
  const farmCapable = overview?.organization.capabilities.includes("FARM") ?? true;
  if (!can("materials.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền materials.read"))} />;
  const rows = q.data?.filter((m) => !kind || m.kind === kind);
  const columns: Column<Material>[] = [
    { key: "code", header: tr("Mã"), sort: (m) => m.code, cell: (m) => <span className="font-mono text-[12px]">{m.code}</span> },
    { key: "name", header: tr("Tên"), sort: (m) => m.name, cell: (m) => <span className="flex flex-col"><span className="font-medium">{m.name}</span><span className="text-[11.5px] text-ink-2">{[m.seedType, m.supplier].filter(Boolean).join(" · ")}</span></span> },
    { key: "kind", header: tr("Loại"), cell: (m) => <span className="text-[12.5px]">{MATERIAL_KIND_LABEL[m.kind]}</span> },
    { key: "unit", header: tr("Đơn vị"), hideBelow: "md", cell: (m) => <span className="text-[12.5px]">{m.unit}</span> },
    { key: "ev", header: tr("Ảnh"), hideBelow: "md", cell: (m) => (m.evidenceComplete ? <Badge tone="ok">{tr("Đủ")}</Badge> : <Badge tone="warn">{tr("Thiếu")}</Badge>) },
    { key: "status", header: tr("Trạng thái"), cell: (m) => <Badge tone={m.status === "ACTIVE" ? "ok" : "neutral"}>{m.status === "ACTIVE" ? tr("Đang dùng") : tr("Ngừng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (m) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/materials/${m.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <>
      <PageHeader
        title={tr("Giống & vật tư")}
        description={tr("Danh mục đầu vào của tổ chức sản xuất: giống, phân bón, thuốc bảo vệ thực vật và vật tư khác. Mục mới ở trạng thái ngừng cho tới khi có ảnh giống/vật tư và được hoàn tất.")}
        actions={can("materials.manage") && farmCapable && <Button size="sm" onClick={() => router.push("/enterprise/materials/new")}><Plus /> {tr("Thêm giống/vật tư")}</Button>}
      />
      <PageBody className="min-w-0">
        {!farmCapable && <Callout tone="info">{tr("Danh mục đầu vào chỉ dành cho tổ chức có năng lực sản xuất (FARM).")}</Callout>}
        <div className="flex flex-wrap gap-2">
          <FilterSelect label={tr("Loại")} value={kind} onChange={setKind} options={Object.entries(MATERIAL_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        </div>
        <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(m) => m.id} empty={<EmptyState title={tr("Chưa có giống/vật tư")} />} />
        </div>
      </PageBody>
      <MaterialSheet row={q.data?.find((m) => m.id === openId) ?? null} onClose={() => {setOpenId(null);router.push("/enterprise/materials");}} canManage={can("materials.manage")} canEvidence={can("materials.manage") && can("evidence.manage")} />
      <CommandDialog {...add.props} open={view==="new" && can("materials.manage") && farmCapable} onOpenChange={o=>{if(!o)router.push("/enterprise/materials");}} onDone={()=>router.push("/enterprise/materials")} title={tr("Thêm giống/vật tư")} endpoint="POST /enterprise-workspace/materials" description={tr("Mã do hệ thống tự sinh. Mục mới ở trạng thái ngừng cho tới khi hoàn tất ảnh.")} schema={createSchema} defaultValues={{ code: "", name: "", kind: "SEED", unit: "", seedType: "", supplier: "", batchCode: "", activeIngredient: "", price: "", origin: "", manufacturer: "", description: "", withdrawalDays: "", expiryDate: "" }} submitLabel={tr("Thêm")} invalidate={[["ws-materials"]]} wide run={(v, cmd) => wapi.createMaterial(toInput(v), cmd)}>
        {(f) => <MaterialFields f={f as never} creating />}
      </CommandDialog>
    </>
  );
}

function MaterialFields({ f, creating }: { f: { control: never; watch: (k: string) => string }; creating?: boolean }) {
  const c = f.control;
  const kind = f.watch("kind");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={c} name="name" label={tr("Tên")} max={255} />
        <SelectField control={c} name="kind" label={tr("Loại")} options={Object.entries(MATERIAL_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
        {!creating && <TextField control={c} name="code" label={tr("Mã")} />}
        <ReferenceSelectField control={c} name="unit" label={tr("Đơn vị tính")} category="UNIT" />
        {kind === "SEED" && <TextField control={c} name="seedType" label={tr("Loại giống")} />}
        {kind === "PROTECTION" && <TextField control={c} name="activeIngredient" label={tr("Hoạt chất")} />}
        {kind === "PROTECTION" && <TextField control={c} name="withdrawalDays" label={tr("Thời gian cách ly (ngày)")} type="number" />}
        <TextField control={c} name="supplier" label={tr("Nhà cung cấp")} />
        <TextField control={c} name="manufacturer" label={tr("Nhà sản xuất")} />
        <TextField control={c} name="batchCode" label={tr("Số lô")} />
        <TextField control={c} name="origin" label={tr("Xuất xứ")} />
        <TextField control={c} name="price" label={tr("Đơn giá (VND)")} type="number" />
        <TextField control={c} name="expiryDate" label={tr("Hạn dùng")} type="date" />
      </div>
      <TextAreaField control={c} name="description" label={tr("Mô tả")} max={2000} />
    </>
  );
}

function MaterialSheet({ row, onClose, canManage, canEvidence }: { row: Material | null; onClose: () => void; canManage: boolean; canEvidence: boolean }) {
  const qc = useQueryClient();
  const edit = useDialog();
  const complete = useDialog();
  const m = row;
  return (
    <Sheet open={!!m} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {m && (
          <>
            <SheetHeader>
              <SheetTitle>{m.name}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{m.code}</span> · {MATERIAL_KIND_LABEL[m.kind]} · v{m.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={m.status === "ACTIVE" ? "ok" : "neutral"}>{m.status === "ACTIVE" ? tr("Đang dùng") : tr("Ngừng")}</Badge>
                {m.evidenceComplete ? <Badge tone="ok">{tr("Hồ sơ ảnh đã hoàn tất")}</Badge> : <Badge tone="warn">{tr("Chưa hoàn tất hồ sơ ảnh")}</Badge>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit.open(true)}>{tr("Sửa thông tin")}</Button>
                  {!m.evidenceComplete && <Button size="sm" onClick={() => complete.open(true)}>{tr("Hoàn tất hồ sơ ảnh")}</Button>}
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Đơn vị tính"), m.unit],
                  [tr("Loại giống"), m.seedType],
                  [tr("Hoạt chất"), m.activeIngredient],
                  [tr("Thời gian cách ly"), m.withdrawalDays !== null ? `${m.withdrawalDays} ${tr("ngày")}` : null],
                  [tr("Nhà cung cấp"), m.supplier],
                  [tr("Nhà sản xuất"), m.manufacturer],
                  [tr("Số lô"), m.batchCode],
                  [tr("Xuất xứ"), m.origin],
                  [tr("Đơn giá"), m.price && `${fmtNumber(m.price)} VND`],
                  [tr("Hạn dùng"), m.expiryDate && fmtDate(m.expiryDate)],
                  [tr("Mô tả"), m.description],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
              <EvidencePanel entityType="MATERIAL" entityId={m.id} canManage={canEvidence} required={[{ kind: m.kind === "SEED" ? "SEED_IMAGE" : "MATERIAL_IMAGE", min: 1 }]} onChanged={() => qc.invalidateQueries({ queryKey: ["ws-materials"] })} />
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Lịch sử phiên bản")}</h3>
                <RevisionHistory entityType="MATERIAL" id={m.id} />
              </section>
            </div>
            {edit.target && (
              <CommandDialog
                {...edit.props}
                title={tr("Sửa {p0}", { p0: m.name })}
                endpoint={`POST /enterprise-workspace/materials/${m.id}`}
                description={tr("Đổi loại (ví dụ từ vật tư sang giống) đưa mục về trạng thái ngừng và cần hoàn tất ảnh lại. Kích hoạt cần hồ sơ ảnh đã hoàn tất.")}
                schema={reviseSchema}
                defaultValues={{ ...fromRow(m), status: z.enum(["ACTIVE","INACTIVE"]).parse(m.status), reason: "" }}
                version={m.version}
                wide
                submitLabel={tr("Lưu phiên bản mới")}
                invalidate={[["ws-materials"], ["ws-revisions", "MATERIAL", m.id]]}
                run={(v, cmd) => wapi.reviseMaterial(m.id, { material: toInput(v), status: v.status, version: m.version, reason: v.reason }, cmd)}
              >
                {(f) => (
                  <>
                    <MaterialFields f={f as never} />
                    <ChoiceField control={f.control} name="status" label={tr("Trạng thái")} options={[{ value: "ACTIVE", label: tr("Đang dùng") }, { value: "INACTIVE", label: tr("Ngừng") }]} />
                    <TextAreaField control={f.control} name="reason" label={tr("Lý do thay đổi")} max={1000} />
                  </>
                )}
              </CommandDialog>
            )}
            {complete.target && (
              <CommandDialog {...complete.props} title={tr("Hoàn tất hồ sơ ảnh · {p0}", { p0: m.name })} endpoint={`POST /enterprise-workspace/materials/${m.id}/complete`} description={m.kind === "SEED" ? tr("Cần ít nhất một ảnh giống hiện hành.") : tr("Cần ít nhất một ảnh vật tư hiện hành.")} schema={emptySchema} defaultValues={{}} version={m.version} submitLabel={tr("Hoàn tất")} invalidate={[["ws-materials"]]} run={(_, cmd) => wapi.completeMaterial(m.id, { version: m.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
