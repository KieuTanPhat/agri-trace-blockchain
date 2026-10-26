"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery,useLedgerQueryClient as useQueryClient} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import { z } from "zod";
import { Plus } from "lucide-react";
import { wapi, type SiteInput } from "@/lib/ledger/resource-api";
import type { Site, Vehicle } from "@/lib/ledger/resource-types";
import { fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { SITE_KIND_LABEL } from "@/lib/ledger/resource-types";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { ReferenceSelectField } from "@/components/ledger/kit/reference-select";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { RevisionHistory } from "@/components/ledger/workspace/revision-history";
import { cn } from "@/lib/ledger/utils";

const KINDS = ["PRODUCTION", "PACKING", "WAREHOUSE", "COLD_STORAGE", "PROCESSING", "DISTRIBUTION", "RETAIL", "OTHER"] as const;
const optNumber = z.union([z.literal(""), z.coerce.number<number>().positive({ error: () => tr("Phải là số dương") })]).optional();
const optText = (max: number) => z.string().trim().max(max).optional();
// EnterpriseSiteInput (enterprise-workspace/dto.ts)
const siteFields = {
  name: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
  kind: z.enum(KINDS),
  address: z.string().trim().min(5, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 5 }) }).max(500),
  ward: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
  region: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(255),
  areaM2: z.coerce.number<number>({ error: () => tr("Nhập số") }).positive({ error: () => tr("Phải là số dương") }),
  coldAreaM2: optNumber,
  capacityKg: optNumber,
  expectedOutputTons: optNumber,
  manager: optText(255),
  representative: optText(255),
  phone: optText(30),
  email: z.union([z.literal(""), z.email({ error: () => tr("Email không hợp lệ") })]).optional(),
  otherInfo: optText(2000),
  staffUserId: z.string().optional(),
  farmId:z.string().optional(),
};
const siteSchema = z.object(siteFields);
const reviseSchema = z.object({ ...siteFields, status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000) });
const vehicleFields = { kind: z.string().trim().min(2, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 2 }) }).max(100), registration: z.string().trim().min(3, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 3 }) }).max(40) };
const vehicleSchema = z.object(vehicleFields);
const vehicleReviseSchema = z.object({ ...vehicleFields, status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000) });
const emptySchema = z.object({});

type SiteValues = z.infer<typeof siteSchema>;
const blank = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);
function toInput(v: SiteValues): SiteInput {
  return {
    name: v.name,
    kind: v.kind,
    address: v.address,
    ward: v.ward,
    region: v.region,
    areaM2: v.areaM2,
    coldAreaM2: blank(v.coldAreaM2) as number | undefined,
    capacityKg: blank(v.capacityKg) as number | undefined,
    expectedOutputTons: blank(v.expectedOutputTons) as number | undefined,
    manager: blank(v.manager) as string | undefined,
    representative: blank(v.representative) as string | undefined,
    phone: blank(v.phone) as string | undefined,
    email: blank(v.email) as string | undefined,
    otherInfo: blank(v.otherInfo) as string | undefined,
    staffUserId: blank(v.staffUserId) as string | undefined,
    farmId:typeof v.farmId==="string" && v.farmId?v.farmId:undefined,
  };
}
const fromSite = (s: Site): SiteValues => ({
  name: s.name,
  kind: siteFields.kind.parse(s.kind),
  address: s.address,
  ward: s.ward ?? "",
  region: s.region ?? "",
  areaM2: Number(s.areaM2 ?? 0),
  coldAreaM2: s.coldAreaM2 ? Number(s.coldAreaM2) : "",
  capacityKg: s.capacityKg ? Number(s.capacityKg) : "",
  expectedOutputTons: s.expectedOutputTons ? Number(s.expectedOutputTons) : "",
  manager: s.manager ?? "",
  representative: s.representative ?? "",
  phone: s.phone ?? "",
  email: s.email ?? "",
  otherInfo: s.otherInfo ?? "",
  staffUserId: s.staffUserId ?? "",farmId:s.farmId ?? "",
});

export default function SitesPage({view="list",resourceId,family="sites"}:{view?:"list"|"new"|"detail";resourceId?:string;family?:"sites"|"vehicles"}) {
  const router=useRouter();
  const { can: canPermission, primary, access } = useWorkspaceAccess();
  // Vehicles belong to transport companies; others type the plate on the transfer.
  const transporter = !!access?.capabilities.includes("TRANSPORTER");
  const can = (permission: string) => (permission.startsWith("vehicles.") ? transporter : true) && canPermission(permission);
  const [picked, setTab] = useState<"sites" | "vehicles" | null>(family);
  const tab = picked ?? (can("sites.read") || !can("vehicles.read") ? "sites" : "vehicles");
  const [openSite, setOpenSite] = useState<string | null>(family==="sites"?resourceId ?? null:null);
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("sites.read") });
  const vehicles = useQuery({ queryKey: ["ws-vehicles"], queryFn: wapi.vehicles, enabled: can("vehicles.read") });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const add = useDialog<"site" | "vehicle">();
  const editVehicle = useDialog<Vehicle>();
  const staffOptions = (members.data ?? []).filter((m) => m.accountStatus === "ACTIVE").map((m) => ({ value: m.id, label: m.fullName }));

  const siteCols: Column<Site>[] = [
    { key: "name", header: tr("Cơ sở"), sort: (s) => s.name, cell: (s) => <span className="flex flex-col"><span className="font-medium">{s.name}</span><span className="text-[11.5px] text-ink-2">{s.address}</span></span> },
    { key: "kind", header: tr("Loại"), cell: (s) => <span className="text-[12px]">{SITE_KIND_LABEL[s.kind] ?? s.kind}</span> },
    { key: "region", header: tr("Khu vực"), hideBelow: "md", cell: (s) => <span className="text-ink-2">{s.region}</span> },
    { key: "size", header: tr("Diện tích / sức chứa"), hideBelow: "lg", cell: (s) => <span className="font-mono text-[12px]">{fmtNumber(s.areaM2)} m²{s.capacityKg ? ` · ${fmtNumber(s.capacityKg)} kg` : ""}</span> },
    { key: "ev", header: tr("Ảnh chứng cứ"), hideBelow: "md", cell: (s) => (s.evidenceComplete ? <Badge tone="ok">{tr("Đủ")}</Badge> : <Badge tone="warn">{tr("Thiếu")}</Badge>) },
    { key: "status", header: tr("Trạng thái"), cell: (s) => <Badge tone={s.status === "ACTIVE" ? "ok" : "neutral"}>{s.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (s) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/sites/${s.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  const vehicleCols: Column<Vehicle>[] = [
    { key: "reg", header: tr("Biển số"), sort: (v) => v.registration, cell: (v) => <span className="font-mono">{v.registration}</span> },
    { key: "kind", header: tr("Loại xe"), cell: (v) => <span>{v.kind}</span> },
    { key: "ver", header: tr("Phiên bản"), hideBelow: "md", cell: (v) => <span className="font-mono text-[12px]">v{v.version}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (v) => <Badge tone={v.status === "ACTIVE" ? "ok" : "neutral"}>{v.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (v) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/vehicles/${v.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  const current = sites.data?.find((s) => s.id === openSite) ?? null;
  const vehicleDetail=family==="vehicles" && resourceId?vehicles.data?.find(v=>v.id===resourceId):undefined;
  const vehicle=editVehicle.target;
  const toggleVehicle=useDialog();

  if(!can(family==="sites"?"sites.read":"vehicles.read"))return <ErrorState error={new Error(tr("Bạn chưa có quyền xem tài nguyên này"))}/>;
  return (
    <>
      <PageHeader
        title={tr("Cơ sở & phương tiện")}
        description={tr("Cơ sở là phạm vi để gán quyền cho thành viên. Cơ sở mới tạo ở trạng thái ngừng; tải ảnh cơ sở rồi hoàn tất hồ sơ để đưa vào hoạt động. Mọi lần sửa đều lưu phiên bản trước kèm lý do.")}
        actions={
          tab === "sites"
            ? can("sites.manage") && primary && (
                <Button size="sm" onClick={() => router.push("/enterprise/sites/new")}>
                  <Plus /> {tr("Thêm cơ sở")}
                </Button>
              )
            : can("vehicles.manage") && (
                <Button size="sm" onClick={() => router.push("/enterprise/vehicles/new")}>
                  <Plus /> {tr("Thêm phương tiện")}
                </Button>
              )
        }
      />
      <PageBody className="min-w-0">
        <div role="tablist" className="flex gap-1">
          {(["sites", "vehicles"] as const)
            .filter((k) => can(k === "sites" ? "sites.read" : "vehicles.read"))
            .map((k) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => {setTab(k);router.push(`/enterprise/${k}`);}} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
                {k === "sites" ? tr("Cơ sở") : tr("Phương tiện")}
              </button>
            ))}
        </div>
        {tab === "sites" && !primary && <Callout>{tr("Bạn chỉ thấy cơ sở thuộc phạm vi các nhóm quyền được gán. Cơ sở mới do chủ quản tạo.")}</Callout>}
        <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-card">
          {tab === "sites" ? (
            <DataTable rows={sites.data} loading={sites.isLoading} error={sites.error} onRetry={() => sites.refetch()} columns={siteCols} rowKey={(s) => s.id} empty={<EmptyState title={tr("Chưa có cơ sở trong phạm vi")} />} />
          ) : (
            <DataTable rows={vehicles.data} loading={vehicles.isLoading} error={vehicles.error} onRetry={() => vehicles.refetch()} columns={vehicleCols} rowKey={(v) => v.id} empty={<EmptyState title={tr("Chưa có phương tiện")} />} minWidth={520} />
          )}
        </div>
      </PageBody>

      <SiteSheet site={current} onClose={() => {setOpenSite(null);router.push("/enterprise/sites");}} canManage={can("sites.manage")} canEvidence={can("evidence.manage") && can("sites.manage")} primary={primary} staffOptions={staffOptions} />

      {view==="new" && family==="sites" && can("sites.manage") && primary && (
        <CommandDialog
          {...add.props} open onOpenChange={o=>{if(!o)router.push(`/enterprise/${family}`);}} onDone={()=>router.push(`/enterprise/${family}`)}
          title={tr("Thêm cơ sở")}
          endpoint="POST /enterprise-workspace/sites"
          description={tr("Cơ sở mới ở trạng thái ngừng cho tới khi có ảnh cơ sở và được hoàn tất hồ sơ.")}
          schema={siteSchema}
          defaultValues={{ name: "", kind: "WAREHOUSE", address: "", ward: "", region: "", areaM2: "" as unknown as number, coldAreaM2: "", capacityKg: "", expectedOutputTons: "", manager: "", representative: "", phone: "", email: "", otherInfo: "", staffUserId: "",farmId:"" }}
          submitLabel={tr("Thêm cơ sở")}
          invalidate={[["ws-sites"], ["ws-overview"]]}
          wide
          run={(v, cmd) => wapi.createSite(toInput(v), cmd)}
        >
          {(f) => <SiteFields f={f as never} staffOptions={staffOptions} />}
        </CommandDialog>
      )}
      {view==="new" && family==="vehicles" && can("vehicles.manage") && (
        <CommandDialog {...add.props} open onOpenChange={o=>{if(!o)router.push("/enterprise/vehicles");}} onDone={()=>router.push("/enterprise/vehicles")} title={tr("Thêm phương tiện")} endpoint="POST /enterprise-workspace/vehicles" schema={vehicleSchema} defaultValues={{ kind: "", registration: "" }} submitLabel={tr("Thêm")} invalidate={[["ws-vehicles"]]} run={(v, cmd) => wapi.createVehicle(v, cmd)}>
          {(f) => (
            <>
              <TextField control={f.control} name="registration" label={tr("Biển số")} />
              <ReferenceSelectField control={f.control} name="kind" label={tr("Loại xe")} category="VEHICLE_TYPE" />
            </>
          )}
        </CommandDialog>
      )}
      <Sheet open={!!vehicleDetail} onOpenChange={o=>{if(!o)router.push("/enterprise/vehicles");}}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{vehicleDetail?.registration}</SheetTitle><SheetDescription>{tr("Phương tiện")} · v{vehicleDetail?.version}</SheetDescription></SheetHeader>{vehicleDetail && <div className="flex flex-col gap-5 px-4 pb-6"><Badge tone={vehicleDetail.status==="ACTIVE"?"ok":"neutral"}>{vehicleDetail.status==="ACTIVE"?tr("Hoạt động"):tr("Ngừng")}</Badge><p className="text-sm">{vehicleDetail.kind}</p>{can("vehicles.manage") && <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>editVehicle.open(vehicleDetail)}>{tr("Sửa thông tin")}</Button><Button size="sm" variant="outline" onClick={()=>toggleVehicle.open(true)}>{vehicleDetail.status==="ACTIVE"?tr("Ngừng"):tr("Kích hoạt")}</Button></div>}{primary && <RevisionHistory entityType="VEHICLE" id={vehicleDetail.id}/>}</div>}</SheetContent></Sheet>
      {vehicleDetail && can("vehicles.manage") && <CommandDialog {...toggleVehicle.props} title={vehicleDetail.status==="ACTIVE"?tr("Ngừng phương tiện"):tr("Kích hoạt phương tiện")} endpoint={`POST /enterprise-workspace/vehicles/${vehicleDetail.id}/status`} schema={emptySchema} defaultValues={{}} version={vehicleDetail.version} submitLabel={tr("Xác nhận")} description={tr("Đối soát chặng đang mở trước khi ngừng sử dụng.")} invalidate={[["ws-vehicles"]]} run={(_,cmd)=>wapi.vehicleStatus(vehicleDetail.id,{version:vehicleDetail.version,status:vehicleDetail.status==="ACTIVE"?"INACTIVE":"ACTIVE"},cmd)}>{()=>null}</CommandDialog>}
      {can("vehicles.manage") && vehicle && (
        <CommandDialog
          {...editVehicle.props}
          title={tr("Sửa phương tiện {p0}", { p0: vehicle.registration })}
          endpoint={`POST /enterprise-workspace/vehicles/${vehicle.id}/revisions`}
          description={tr("Bản hiện hành được lưu thành phiên bản trước kèm lý do. Ngừng phương tiện đang dùng trong chặng giao nhận chưa hoàn tất bị từ chối.")}
          schema={vehicleReviseSchema}
          defaultValues={{ kind: vehicle.kind, registration: vehicle.registration, status: z.enum(["ACTIVE","INACTIVE"]).parse(vehicle.status), reason: "" }}
          version={vehicle.version}
          submitLabel={tr("Lưu phiên bản mới")}
          invalidate={[["ws-vehicles"]]}
          run={(v, cmd) => wapi.reviseVehicle(vehicle.id, { vehicle: { registration: v.registration, kind: v.kind }, status: v.status, version: vehicle.version, reason: v.reason }, cmd)}
        >
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField control={f.control} name="registration" label={tr("Biển số")} />
                <ReferenceSelectField control={f.control} name="kind" label={tr("Loại xe")} category="VEHICLE_TYPE" />
              </div>
              <ChoiceField control={f.control} name="status" label={tr("Trạng thái")} options={[{ value: "ACTIVE", label: tr("Hoạt động") }, { value: "INACTIVE", label: tr("Ngừng") }]} />
              <TextAreaField control={f.control} name="reason" label={tr("Lý do thay đổi")} max={1000} />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}

function SiteFields({ f, staffOptions }: { f: { control: never }; staffOptions: { value: string; label: string }[] }) {
  const c = f.control;
  const catalog=useQuery({queryKey:["ws-catalog"],queryFn:wapi.catalog,enabled:useWorkspaceAccess().can("catalog.read")});
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={c} name="name" label={tr("Tên cơ sở")} max={255} />
        <SelectField control={c} name="kind" label={tr("Loại")} options={Object.entries(SITE_KIND_LABEL).map(([value, label]) => ({ value, label }))} />
      </div>
      <SelectField control={c} name="farmId" label={tr("Vùng liên kết")} options={(catalog.data?.farms??[]).filter(f=>f.status==="ACTIVE" && f.evidenceComplete).map(f=>({value:f.id,label:f.name}))}/>
      <TextField control={c} name="address" label={tr("Địa chỉ")} max={500} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={c} name="ward" label={tr("Phường/xã")} />
        <TextField control={c} name="region" label={tr("Tỉnh/thành")} />
        <TextField control={c} name="areaM2" label={tr("Diện tích (m²)")} type="number" />
        <TextField control={c} name="coldAreaM2" label={tr("Diện tích lạnh (m²)")} type="number" />
        <TextField control={c} name="capacityKg" label={tr("Sức chứa (kg)")} type="number" />
        <TextField control={c} name="expectedOutputTons" label={tr("Sản lượng dự kiến (tấn)")} type="number" />
        <TextField control={c} name="manager" label={tr("Người quản lý")} />
        <TextField control={c} name="representative" label={tr("Người đại diện")} />
        <TextField control={c} name="phone" label={tr("Điện thoại")} />
        <TextField control={c} name="email" label={tr("Email")} />
      </div>
      {staffOptions.length > 0 && <SelectField control={c} name="staffUserId" label={tr("Nhân viên phụ trách")} options={staffOptions} />}
      <TextAreaField control={c} name="otherInfo" label={tr("Thông tin khác")} max={2000} />
    </>
  );
}

function SiteSheet({ site, onClose, canManage, canEvidence, primary, staffOptions }: { site: Site | null; onClose: () => void; canManage: boolean; canEvidence: boolean; primary: boolean; staffOptions: { value: string; label: string }[] }) {
  const qc = useQueryClient();
  const edit = useDialog();
  const complete = useDialog();
  const toggle = useDialog();
  const refresh = () => qc.invalidateQueries({ queryKey: ["ws-sites"] });
  const s = site;
  return (
    <Sheet open={!!s} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {s && (
          <>
            <SheetHeader>
              <SheetTitle>{s.name}</SheetTitle>
              <SheetDescription>
                {SITE_KIND_LABEL[s.kind] ?? s.kind} · {s.address} · v{s.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={s.status === "ACTIVE" ? "ok" : "neutral"}>{s.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge>
                {s.evidenceComplete ? <Badge tone="ok">{tr("Hồ sơ ảnh đã hoàn tất")}</Badge> : <Badge tone="warn">{tr("Chưa hoàn tất hồ sơ ảnh")}</Badge>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => edit.open(true)}>{tr("Sửa thông tin")}</Button>
                  {!s.evidenceComplete && <Button size="sm" onClick={() => complete.open(true)}>{tr("Hoàn tất hồ sơ ảnh")}</Button>}
                  {s.evidenceComplete && <Button size="sm" variant="outline" onClick={() => toggle.open(true)}>{s.status === "ACTIVE" ? tr("Ngừng") : tr("Kích hoạt")}</Button>}
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Phường/xã"), s.ward],
                  [tr("Tỉnh/thành"), s.region],
                  [tr("Diện tích"), s.areaM2 && `${fmtNumber(s.areaM2)} m²`],
                  [tr("Diện tích lạnh"), s.coldAreaM2 && `${fmtNumber(s.coldAreaM2)} m²`],
                  [tr("Sức chứa"), s.capacityKg && `${fmtNumber(s.capacityKg)} kg`],
                  [tr("Sản lượng dự kiến"), s.expectedOutputTons && `${fmtNumber(s.expectedOutputTons)} ${tr("tấn")}`],
                  [tr("Người quản lý"), s.manager],
                  [tr("Người đại diện"), s.representative],
                  [tr("Điện thoại"), s.phone],
                  ["Email", s.email],
                  [tr("Nhân viên phụ trách"), staffOptions.find((o) => o.value === s.staffUserId)?.label ?? s.staffUserId],
                  [tr("Thông tin khác"), s.otherInfo],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="min-w-0 break-words">{v}</dd>
                    </div>
                  ))}
              </dl>
              <EvidencePanel entityType="SITE" entityId={s.id} canManage={canEvidence} required={[{ kind: "SITE_IMAGE", min: 1 }]} onChanged={refresh} />
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Lịch sử phiên bản")}</h3>
                {primary ? <RevisionHistory entityType="SITE" id={s.id} /> : <p className="text-[12.5px] text-ink-2">{tr("Chỉ chủ quản xem lịch sử hồ sơ có thông tin quản lý.")}</p>}
              </section>
            </div>

            {edit.target && (
              <CommandDialog
                {...edit.props}
                title={tr("Sửa cơ sở {p0}", { p0: s.name })}
                endpoint={`POST /enterprise-workspace/sites/${s.id}/revisions`}
                description={tr("Bản hiện hành được lưu thành phiên bản trước kèm lý do. Kích hoạt cần hồ sơ ảnh đã hoàn tất; ngừng cơ sở còn tồn bị từ chối.")}
                schema={reviseSchema}
                defaultValues={{ ...fromSite(s), status: z.enum(["ACTIVE","INACTIVE"]).parse(s.status), reason: "" }}
                version={s.version}
                wide
                submitLabel={tr("Lưu phiên bản mới")}
                invalidate={[["ws-sites"], ["ws-revisions", "SITE", s.id]]}
                run={(v, cmd) => wapi.reviseSite(s.id, { site: toInput(v), status: v.status, version: s.version, reason: v.reason }, cmd)}
              >
                {(f) => (
                  <>
                    <SiteFields f={f as never} staffOptions={staffOptions} />
                    <ChoiceField control={f.control} name="status" label={tr("Trạng thái")} options={[{ value: "ACTIVE", label: tr("Hoạt động") }, { value: "INACTIVE", label: tr("Ngừng") }]} />
                    <TextAreaField control={f.control} name="reason" label={tr("Lý do thay đổi")} max={1000} />
                  </>
                )}
              </CommandDialog>
            )}
            {complete.target && (
              <CommandDialog {...complete.props} title={tr("Hoàn tất hồ sơ ảnh · {p0}", { p0: s.name })} endpoint={`POST /enterprise-workspace/sites/${s.id}/complete`} description={tr("Cần ít nhất một ảnh cơ sở hiện hành. Hoàn tất sẽ đưa cơ sở vào hoạt động.")} schema={emptySchema} defaultValues={{}} version={s.version} submitLabel={tr("Hoàn tất")} invalidate={[["ws-sites"]]} run={(_, cmd) => wapi.completeSite(s.id, { version: s.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {toggle.target && (
              <CommandDialog
                {...toggle.props}
                title={`${s.status === "ACTIVE" ? tr("Ngừng") : tr("Kích hoạt")} ${s.name}`}
                endpoint={`POST /enterprise-workspace/sites/${s.id}/status`}
                description={tr("Ngừng cơ sở còn tồn hàng bị từ chối; kích hoạt cần đủ ảnh cơ sở.")}
                schema={emptySchema}
                defaultValues={{}}
                version={s.version}
                submitLabel={tr("Xác nhận")}
                invalidate={[["ws-sites"]]}
                run={(_, cmd) => wapi.siteStatus(s.id, { status: s.status === "ACTIVE" ? "INACTIVE" : "ACTIVE", version: s.version }, cmd)}
              >
                {() => null}
              </CommandDialog>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
