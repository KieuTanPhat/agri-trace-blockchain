"use client";

import { useRef, useState } from "react";
import { useLedgerQuery as useQuery, useLedgerQueryClient as useQueryClient } from "@/lib/ledger/data";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ledger/ui/input";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { parseCatalogCsv, catalogCsvTemplate } from "@/lib/catalog-csv";


import { z } from "zod";
import { ArrowDown, ArrowUp, FileUp, Loader2, Plus } from "lucide-react";

type ApiError = Error;
import { wapi } from "@/lib/ledger/product-api";
import type { Farm, ImportPreview, Member, Product, ProductInput, Site } from "@/lib/ledger/product-types";
import { fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { Textarea } from "@/components/ledger/ui/textarea";
import { CommandDialog, CommandForm, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { ReferenceSelectField } from "@/components/ledger/kit/reference-select";
import { Callout, EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { PhotoPicker } from "@/components/ledger/workspace/photo-picker";
import { newLedgerCommandKey } from "@/lib/ledger/command-context";
import { Controller, type Control } from "react-hook-form";
import { RevisionHistory } from "@/components/ledger/workspace/revision-history";

function currentVersion(version:number|undefined){if(version===undefined)throw new Error("Thiếu phiên bản hiện hành");return version;}
const opt = (max: number) => z.string().trim().max(max).optional();
const req = (min: number, max: number) => z.string().trim().min(min, { error: () => tr("Tối thiểu {p0} ký tự", { p0: min }) }).max(max);
// ProductInput (enterprise-workspace/resources.dto.ts) và ProductDto (catalog.module.ts)
const fields = {
  productName: req(1, 255),
  sku: opt(100),
  gtin: z.union([z.literal(""), z.string().regex(/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/, { error: () => tr("GTIN gồm 8, 12, 13 hoặc 14 chữ số") })]).optional(),
  category: req(2, 100),
  variety: opt(255),
  defaultUnit: req(1, 30),
  originFarmId: z.string().min(1, { error: () => tr("Chọn vùng sản xuất") }),
  price: z.union([z.literal(""), z.coerce.number<number>().min(0, { error: () => tr("≥ 0") })]).optional(),
  storageConditions: req(2, 2000),
  ingredients: req(2, 2000),
  usageInstructions: req(2, 2000),
  rawMaterials: opt(2000),
  manufacturingSiteId: z.string().optional(),
  managerUserId: z.string().optional(),
  exporter: opt(255),
  importer: opt(255),
  distributor: opt(255),
  carrier: opt(255),
  description: opt(2000),
};
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const baseSchema = z.object(fields);
// A new product starts with at least one photo; completion needs that current photo.
const createSchema = baseSchema.extend({ photos: z.array(z.instanceof(File)).min(1, { error: () => tr("Chọn ít nhất một ảnh sản phẩm") }).max(10, { error: () => tr("Tối đa 10 ảnh mỗi lần") }).refine((files) => files.every((f) => /^image\/(png|jpeg)$/.test(f.type) && f.size > 0 && f.size <= PHOTO_MAX_BYTES), { error: () => tr("Ảnh PNG hoặc JPEG, tối đa 5 MB") }) });
const reviseSchema = z.object({ ...fields, sku: req(1, 100), status: z.enum(["ACTIVE", "INACTIVE"]), reason: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000) });
const emptySchema = z.object({});
type Values = z.infer<typeof baseSchema>;
const blank = <V,>(v: V) => (v === "" || v === undefined || v === null ? undefined : v);
function toInput(v: Values): ProductInput {
  return {
    productName: v.productName,
    sku: v.sku || undefined,
    gtin: blank(v.gtin),
    category: v.category,
    variety: blank(v.variety),
    defaultUnit: v.defaultUnit,
    originFarmId: v.originFarmId,
    price: typeof v.price === "number" ? v.price : undefined,
    storageConditions: v.storageConditions,
    ingredients: v.ingredients,
    usageInstructions: v.usageInstructions,
    rawMaterials: blank(v.rawMaterials),
    manufacturingSiteId: blank(v.manufacturingSiteId),
    managerUserId: blank(v.managerUserId),
    exporter: blank(v.exporter),
    importer: blank(v.importer),
    distributor: blank(v.distributor),
    carrier: blank(v.carrier),
    description: blank(v.description),
  };
}
const fromRow = (p: Product): Values => ({
  productName: p.productName,
  sku: p.sku ?? "",
  gtin: p.gtin ?? "",
  category: p.category ?? "",
  variety: p.variety ?? "",
  defaultUnit: p.defaultUnit ?? "",
  originFarmId: p.originFarmId ?? "",
  price: p.price !== null && p.price !== undefined ? Number(p.price) : "",
  storageConditions: p.storageConditions ?? "",
  ingredients: p.ingredients ?? "",
  usageInstructions: p.usageInstructions ?? "",
  rawMaterials: p.rawMaterials ?? "",
  manufacturingSiteId: p.manufacturingSiteId ?? "",
  managerUserId: p.managerUserId ?? "",
  exporter: p.exporter ?? "",
  importer: p.importer ?? "",
  distributor: p.distributor ?? "",
  carrier: p.carrier ?? "",
  description: p.description ?? "",
});

export default function ProductsPage({view="list", productId}: {view?:"list"|"new"|"detail"|"edit"|"import"; productId?:string}) {
  const router=useRouter();
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("");
  const { can } = useWorkspaceAccess();
  const organizationId=useOverview().data?.organization.id;
  const [openId, setOpenId] = useState<string | null>(productId ?? null);
  const [importing, setImporting] = useState(view === "import");
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog, enabled: can("catalog.read") });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("sites.read") });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const add = useDialog();
  // Set by onDone, which runs before the dialog closes, so closing does not
  // send the owner back to the list after a successful create.
  const created = useRef(false);
  if (!can("catalog.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền catalog.read"))} />;
  const farms = catalog.data?.farms ?? [];
  const readyFarms = farms.filter((f) => f.status === "ACTIVE" && f.evidenceComplete);
  const products = catalog.data?.products.filter(p=>p.organizationId===organizationId);
  const filtered = products?.filter(p=>(!status || p.status===status) && [p.productName,p.sku,p.gtin,p.variety,farms.find(f=>f.id===p.originFarmId)?.name].join(" ").toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  const columns: Column<Product>[] = [
    { key: "name", header: tr("Sản phẩm"), sort: (p) => p.productName, cell: (p) => <span className="flex flex-col"><span className="font-medium">{p.productName}</span><span className="font-mono text-[11px] text-ink-2">{p.sku}{p.gtin ? ` · GTIN ${p.gtin}` : ""}</span></span> },
    { key: "farm", header: tr("Vùng xuất xứ"), hideBelow: "md", cell: (p) => <span className="text-[12.5px]">{farms.find((f) => f.id === p.originFarmId)?.name ?? "—"}</span> },
    { key: "unit", header: tr("Đơn vị"), hideBelow: "lg", cell: (p) => <span className="text-[12.5px]">{p.defaultUnit}</span> },
    { key: "price", header: tr("Giá"), hideBelow: "lg", cell: (p) => <span className="font-mono text-[12px]">{p.price ? fmtNumber(p.price) : "—"}</span> },
    { key: "ev", header: tr("Ảnh"), cell: (p) => (p.evidenceComplete ? <Badge tone="ok">{tr("Đủ")}</Badge> : <Badge tone="warn">{tr("Thiếu")}</Badge>) },
    { key: "status", header: tr("Trạng thái"), cell: (p) => <Badge tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status === "ACTIVE" ? tr("Đang bán") : tr("Ngừng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (p) => <Button size="xs" variant="outline" onClick={() => router.push(`/enterprise/products/${p.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  const options = { farms: readyFarms, sites: (sites.data ?? []).filter((s) => s.status === "ACTIVE"), members: (members.data ?? []).filter((m) => m.accountStatus === "ACTIVE") };
  return (
    <>
      <PageHeader
        title={tr("Sản phẩm")}
        description={tr("Danh mục sản phẩm gắn với vùng xuất xứ đã hoàn tất hồ sơ. Sản phẩm mới ở trạng thái ngừng; cần ít nhất một ảnh sản phẩm rồi hoàn tất để bán (tính vào hạn mức sản phẩm của gói).")}
        actions={
          can("catalog.manage") && (
            <>
              <Button size="sm" variant="outline" onClick={() => router.push("/enterprise/products/import")}><FileUp /> {tr("Nhập từ CSV")}</Button>
              <Button size="sm" onClick={() => router.push("/enterprise/products/new")} disabled={!readyFarms.length}><Plus /> {tr("Thêm sản phẩm")}</Button>
            </>
          )
        }
      />
      <PageBody className="min-w-0">
        {can("catalog.manage") && catalog.data && !readyFarms.length && <Callout tone="info">{tr("Chưa có vùng sản xuất đã hoàn tất hồ sơ — hoàn tất vùng trước khi tạo sản phẩm.")}</Callout>}
        <div className="min-w-0 max-w-full overflow-hidden rounded-md border border-line bg-card">
          <div className="flex flex-wrap gap-2 p-3"><Input aria-label={tr("Tìm sản phẩm")} placeholder={tr("Tìm tên, SKU, GTIN, vùng xuất xứ")} value={search} onChange={e=>setSearch(e.target.value)}/><FilterSelect label={tr("Lọc trạng thái")} value={status} onChange={setStatus} options={[{value:"ACTIVE",label:tr("Đang bán")},{value:"INACTIVE",label:tr("Ngừng")}]} /></div><DataTable rows={filtered} loading={catalog.isLoading} error={catalog.error} onRetry={() => catalog.refetch()} columns={columns} rowKey={(p) => p.id} empty={<EmptyState title={tr("Chưa có sản phẩm")} />} />
        </div>
      </PageBody>
      <ProductSheet initialEdit={view === "edit"} product={products?.find((p) => p.id === openId) ?? null} farms={farms} options={options} onClose={() => {setOpenId(null);if(productId)router.push("/enterprise/products");}} canManage={can("catalog.manage") && typeof products?.find(p=>p.id===openId)?.version === "number"} canEvidence={can("catalog.manage") && can("evidence.manage")} />
      <CommandDialog
        {...add.props}
        open={can("catalog.manage") && (view === "new" || add.props.open)}
        onOpenChange={o=>{add.props.onOpenChange(o);if(!o && view==="new" && !created.current)router.push("/enterprise/products");}}
        title={tr("Thêm sản phẩm")}
        endpoint="POST /catalog/products"
        description={tr("Chọn ít nhất một ảnh sản phẩm. SKU do hệ thống tự sinh. Sản phẩm mới ở trạng thái ngừng cho tới khi một ảnh và được hoàn tất.")}
        schema={createSchema}
        defaultValues={{ ...emptyValues(), originFarmId: readyFarms[0]?.id ?? "", photos: [] }}
        submitLabel={tr("Thêm")}
        invalidate={[["ws-catalog"]]}
        wide
        success={(r) => {
          const { uploaded, failed } = r as { uploaded?: number; failed?: number };
          return failed ? tr("Đã thêm sản phẩm; {p0} ảnh chưa tải lên được, hãy tải lại ở trang sản phẩm", { p0: failed }) : uploaded ? tr("Đã thêm sản phẩm kèm {p0} ảnh", { p0: uploaded }) : tr("Đã thêm sản phẩm");
        }}
        onDone={(r) => {
          const id = (r as { id?: string } | undefined)?.id;
          created.current = true;
          router.push(id ? `/enterprise/products/${id}` : "/enterprise/products");
        }}
        run={async (v, cmd) => {
          const product = (await wapi.createProduct(toInput(v), cmd)) as { id: string };
          // Photos are separate evidence commands; a failed upload leaves the
          // product in place for the owner to retry from its detail page.
          let failed = 0;
          const uploaded: string[] = [];
          for (const [i, file] of v.photos.entries())
            try {
              const photo = await wapi.uploadEvidence({ file, entityType: "PRODUCT", entityId: product.id, kind: "PRODUCT_IMAGE", description: tr("Ảnh sản phẩm {p0} ({p1})", { p0: v.productName, p1: i + 1 }) }, { idempotencyKey: newLedgerCommandKey() });
              uploaded.push(String(photo.record.id));
            } catch {
              failed++;
            }
          // Keep the picker's order: its first photo is the main one.
          if (uploaded.length > 1)
            await wapi.orderProductPhotos(product.id, { order: uploaded }, { idempotencyKey: newLedgerCommandKey() }).catch(() => undefined);
          return { id: product.id, uploaded: v.photos.length - failed, failed };
        }}
      >
        {(f) => (
          <>
            <ProductPhotosField control={f.control} />
            <ProductFields f={f as never} options={options} creating />
          </>
        )}
      </CommandDialog>
      <ImportDialog open={importing && can("catalog.manage")} onOpenChange={o=>{setImporting(o);if(!o && view==="import")router.push("/enterprise/products");}} farms={readyFarms} />
    </>
  );
}
const emptyValues = (): Values => ({ productName: "", sku: "", gtin: "", category: "", variety: "", defaultUnit: "kg", originFarmId: "", price: "", storageConditions: "", ingredients: "", usageInstructions: "", rawMaterials: "", manufacturingSiteId: "", managerUserId: "", exporter: "", importer: "", distributor: "", carrier: "", description: "" });

function ProductPhotosField({ control }: { control: Control<z.infer<typeof createSchema>> }) {
  return (
    <Controller
      control={control}
      name="photos"
      render={({ field, fieldState }) => (
        <PhotoPicker required label={tr("Ảnh sản phẩm")} files={field.value} onChange={field.onChange} error={fieldState.error?.message} hint={tr("Ít nhất 1 ảnh, PNG hoặc JPEG tối đa 5 MB. Ảnh đầu tiên là ảnh chính; cần ít nhất 1 ảnh để hoàn tất.")} />
      )}
    />
  );
}

function ProductFields({ f, options, creating }: { f: { control: never }; options: { farms: Farm[]; sites: Site[]; members: Member[] }; creating?: boolean }) {
  const c = f.control;
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={c} name="productName" label={tr("Tên sản phẩm")} max={255} />
        {!creating && <TextField control={c} name="sku" label={tr("SKU")} max={100} />}
        <ReferenceSelectField control={c} name="category" label={tr("Nhóm sản phẩm")} category="PRODUCT_CATEGORY" />
        <TextField control={c} name="variety" label={tr("Giống/chủng loại")} />
        <TextField control={c} name="gtin" label={tr("GTIN")} inputMode="numeric" />
        <ReferenceSelectField control={c} name="defaultUnit" label={tr("Đơn vị tính")} category="UNIT" />
        <SelectField control={c} name="originFarmId" label={tr("Vùng xuất xứ")} options={options.farms.map((x) => ({ value: x.id, label: x.name }))} />
        <TextField control={c} name="price" label={tr("Giá (VND)")} type="number" />
        <SelectField control={c} name="manufacturingSiteId" label={tr("Nhà xưởng sản xuất")} options={options.sites.map((s) => ({ value: s.id, label: s.name }))} />
        <SelectField control={c} name="managerUserId" label={tr("Người quản lý sản phẩm")} options={options.members.map((m) => ({ value: m.id, label: m.fullName }))} />
      </div>
      <TextAreaField control={c} name="storageConditions" label={tr("Điều kiện bảo quản")} max={2000} />
      <TextAreaField control={c} name="ingredients" label={tr("Thành phần")} max={2000} />
      <TextAreaField control={c} name="usageInstructions" label={tr("Hướng dẫn sử dụng")} max={2000} />
      <details className="rounded-md border border-line px-3 py-2">
        <summary className="cursor-pointer text-[13px] font-medium">{tr("Thông tin chuỗi phân phối")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <TextField control={c} name="distributor" label={tr("Nhà phân phối")} />
          <TextField control={c} name="carrier" label={tr("Đơn vị vận chuyển")} />
          <TextField control={c} name="exporter" label={tr("Nhà xuất khẩu")} />
          <TextField control={c} name="importer" label={tr("Nhà nhập khẩu")} />
        </div>
        <TextAreaField control={c} name="rawMaterials" label={tr("Nguyên liệu")} max={2000} className="mt-3" />
      </details>
      <TextAreaField control={c} name="description" label={tr("Mô tả")} max={2000} />
    </>
  );
}

function ProductSheet({ product, farms, options, onClose, canManage, canEvidence, initialEdit }: { initialEdit:boolean; product: Product | null; farms: Farm[]; options: { farms: Farm[]; sites: Site[]; members: Member[] }; onClose: () => void; canManage: boolean; canEvidence: boolean }) {
  const router=useRouter();
  const qc = useQueryClient();
  const edit = useDialog();
  const complete = useDialog();
  const [ordering, setOrdering] = useState(false);
  const p = product;
  const lots=useQuery({queryKey:["ws-product-lots"],queryFn:wapi.lots,enabled:!!p});
  return (
    <Sheet open={!!p} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {p && (
          <>
            <SheetHeader>
              <SheetTitle>{p.productName}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{p.sku}</span> · {farms.find((f) => f.id === p.originFarmId)?.name ?? "—"} · v{p.version}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status === "ACTIVE" ? tr("Đang bán") : tr("Ngừng")}</Badge>
                {p.evidenceComplete ? <Badge tone="ok">{tr("Hồ sơ ảnh đã hoàn tất")}</Badge> : <Badge tone="warn">{tr("Chưa hoàn tất hồ sơ ảnh")}</Badge>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => router.push(`/enterprise/products/${p.id}/edit`)}>{tr("Sửa thông tin")}</Button>
                  <Button size="sm" variant="outline" onClick={() => setOrdering(true)}>{tr("Sắp xếp ảnh")}</Button>
                  {!p.evidenceComplete && <Button size="sm" onClick={() => complete.open(true)}>{tr("Hoàn tất hồ sơ ảnh")}</Button>}
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,150px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                {[
                  [tr("Nhóm sản phẩm"), p.category],
                  [tr("Giống/chủng loại"), p.variety],
                  ["GTIN", p.gtin],
                  [tr("Đơn vị tính"), p.defaultUnit],
                  [tr("Giá"), p.price && `${fmtNumber(p.price)} VND`],
                  [tr("Điều kiện bảo quản"), p.storageConditions],
                  [tr("Thành phần"), p.ingredients],
                  [tr("Hướng dẫn sử dụng"), p.usageInstructions],
                  [tr("Nhà phân phối"), p.distributor],
                  [tr("Người quản lý sản phẩm"), options.members.find((m) => m.id === p.managerUserId)?.fullName],
                  [tr("Mô tả"), p.description],
                ]
                  .filter(([, v]) => v)
                  .map(([k, v]) => (
                    <div key={k as string} className="contents">
                      <dt className="text-ink-2">{k}</dt>
                      <dd className="whitespace-pre-line">{v}</dd>
                    </div>
                  ))}
              </dl>
              <EvidencePanel entityType="PRODUCT" entityId={p.id} canManage={canEvidence} required={[{ kind: "PRODUCT_IMAGE", min: 1 }]} title={tr("Ảnh sản phẩm")} onChanged={() => qc.invalidateQueries({ queryKey: ["ws-catalog"] })} />
              <section className="flex flex-col gap-2"><h3 className="text-[13px] font-semibold">{tr("Lô liên quan")}</h3>{lots.error ? <ErrorState error={lots.error} onRetry={()=>lots.refetch()}/> : <p className="text-sm text-ink-2">{lots.data?.filter(l=>l.productName===p.productName).length ?? "…"} {tr("lô")}</p>}</section>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Lịch sử phiên bản")}</h3>
                <RevisionHistory entityType="PRODUCT" id={p.id} />
              </section>
            </div>
            {canManage && (initialEdit || edit.target) && (
              <CommandDialog
                {...edit.props}
                open={initialEdit || edit.props.open}
                onOpenChange={o=>{edit.props.onOpenChange(o);if(!o && initialEdit)router.push(`/enterprise/products/${p.id}`);}}
                title={tr("Sửa {p0}", { p0: p.productName })}
                endpoint={`POST /enterprise-workspace/products/${p.id}`}
                description={tr("Bản hiện hành được lưu thành phiên bản trước kèm lý do. Vùng xuất xứ phải đã hoàn tất hồ sơ; kích hoạt cần ảnh sản phẩm đã hoàn tất.")}
                schema={reviseSchema}
                defaultValues={{ ...fromRow(p), status: p.status, reason: "" }}
                version={p.version}
                wide
                submitLabel={tr("Lưu phiên bản mới")}
                invalidate={[["ws-catalog"], ["ws-revisions", "PRODUCT", p.id]]}
                run={(v, cmd) => wapi.reviseProduct(p.id, { product: toInput(v), status: v.status, version: currentVersion(p.version), reason: v.reason }, cmd)}
              >
                {(f) => (
                  <>
                    <ProductFields f={f as never} options={options} />
                    <ChoiceField control={f.control} name="status" label={tr("Trạng thái")} options={[{ value: "ACTIVE", label: tr("Đang bán") }, { value: "INACTIVE", label: tr("Ngừng") }]} />
                    <TextAreaField control={f.control} name="reason" label={tr("Lý do thay đổi")} max={1000} />
                  </>
                )}
              </CommandDialog>
            )}
            {complete.target && (
              <CommandDialog {...complete.props} title={tr("Hoàn tất hồ sơ ảnh · {p0}", { p0: p.productName })} endpoint={`POST /catalog/products/${p.id}/complete`} description={tr("Cần ít nhất một ảnh sản phẩm hiện hành. Hoàn tất đưa sản phẩm vào bán và tính vào hạn mức sản phẩm của gói dịch vụ.")} schema={emptySchema} defaultValues={{}} version={p.version} submitLabel={tr("Hoàn tất")} invalidate={[["ws-catalog"], ["ws-overview"]]} run={(_, cmd) => wapi.completeProduct(p.id, { version: currentVersion(p.version) }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            <PhotoOrder productId={p.id} open={ordering} onOpenChange={setOrdering} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Sắp xếp ảnh hiện hành; ảnh đầu tiên là ảnh chính (POST /enterprise-workspace/products/:id/photo-order). */
function PhotoOrder({ productId, open, onOpenChange }: { productId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const q = useQuery({ queryKey: ["ws-evidence", "PRODUCT", productId], queryFn: () => wapi.evidence({ entityType: "PRODUCT", entityId: productId }), enabled: open });
  const [locked,setLocked]=useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const superseded = new Set((q.data ?? []).map((e) => e.supersedesId).filter(Boolean));
  const rows = (q.data ?? []).filter((e) => e.kind === "PRODUCT_IMAGE" && e.mediaType.startsWith("image/") && !superseded.has(e.id));
  const ids = order ?? rows.map((e) => e.id);
  const move = (i: number, d: -1 | 1) => {
    const next = [...ids];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setOrder(next);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { if(locked)return;if (!o) setOrder(null); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tr("Sắp xếp ảnh sản phẩm")}</DialogTitle>
          <DialogDescription>{tr("Ảnh đầu tiên là ảnh chính trên trang truy xuất. Chỉ sắp xếp được ảnh hiện hành.")}</DialogDescription>
        </DialogHeader>
        {!rows.length ? (
          <EmptyState title={tr("Chưa có ảnh")} />
        ) : (
          <ol className="flex flex-col gap-1.5">
            {ids.map((id, i) => {
              const e = rows.find((r) => r.id === id);
              if (!e) return null;
              return (
                <li key={id} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px]">
                  <span className="w-5 font-mono text-ink-2">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">{e.description}</span>
                  {i === 0 && <Badge tone="brand" dot={false}>{tr("Ảnh chính")}</Badge>}
                  <Button size="icon-sm" variant="ghost" aria-label={tr("Lên")} disabled={locked || i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
                  <Button size="icon-sm" variant="ghost" aria-label={tr("Xuống")} disabled={locked || i === ids.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
                </li>
              );
            })}
          </ol>
        )}
        <CommandForm onLockChange={setLocked} onOpenChange={onOpenChange} title={tr("Lưu thứ tự ảnh")} endpoint={`POST /enterprise-workspace/products/${productId}/photo-order`} schema={emptySchema} defaultValues={{}} submitLabel={tr("Lưu thứ tự")} invalidate={[["ws-evidence","PRODUCT",productId]]} run={(_,cmd)=>wapi.orderProductPhotos(productId,{order:ids},cmd)} onDone={()=>{setOrder(null);onOpenChange(false);}}>{()=>null}</CommandForm>
      </DialogContent>
    </Dialog>
  );
}

const CSV_COLUMNS = ["productName", "sku", "category", "originFarmId", "defaultUnit", "storageConditions", "ingredients", "usageInstructions", "gtin", "variety", "price", "description"] as const;
function ImportDialog({ open, onOpenChange, farms }: { open: boolean; onOpenChange: (o: boolean) => void; farms: Farm[] }) {
  const [locked,setLocked]=useState(false);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<(ImportPreview & { rows: Record<string,string|number>[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sample = [CSV_COLUMNS.join(","), `Xoài keo loại 1,TG-XOAI-KEO,FRUIT,${farms[0]?.id ?? "<originFarmId>"},kg,"Bảo quản 10–13 °C",Trái cây tươi 100%,Rửa sạch trước khi dùng,,Keo,52000,`].join("\n");
  const reset = () => { setPreview(null); setError(null); };
  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const rows = parseCatalogCsv(text);
      if (!rows.length) throw new Error(tr("Tệp CSV cần dòng tiêu đề và ít nhất một dòng dữ liệu"));
      const r = await wapi.previewImport({ rows });
      setPreview({ ...r, rows });
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if(locked)return;if (!o) reset(); onOpenChange(o); }}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{tr("Nhập sản phẩm từ CSV")}</DialogTitle>
          <DialogDescription>{tr("Bước 1 xem trước: Backend kiểm từng dòng (ràng buộc trường, vùng xuất xứ đã hoàn tất, SKU không trùng) và trả mã digest. Bước 2 áp dụng đúng nội dung đã xem trước; tối đa 200 dòng, sản phẩm nhập ở trạng thái ngừng.")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-[12.5px] hover:bg-sunken">
              <FileUp className="size-3.5" /> {tr("Chọn tệp .csv")}
              <input disabled={locked} type="file" accept=".csv,text/csv" className="sr-only" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { reset(); if(f.size>1024*1024){setError(tr("Chọn CSV không quá 1 MB"));return;}setText(await f.text()); } }} />
            </label>
            <Button disabled={locked} size="xs" variant="ghost" onClick={() => { setText(sample || catalogCsvTemplate); reset(); }}>{tr("Dùng mẫu")}</Button>
          </div>
          <Textarea disabled={locked} aria-label={tr("Nội dung CSV")} value={text} onChange={(e) => { setText(e.target.value); reset(); }} rows={7} className="font-mono text-[12px]" placeholder={CSV_COLUMNS.join(",")} />
          <p className="text-[11.5px] text-ink-2">{tr("Cột hỗ trợ")}: <span className="font-mono">{CSV_COLUMNS.join(", ")}</span></p>
        </div>
        {preview && (
          <div className="flex flex-col gap-2">
            {preview.canApply ? (
              <Callout tone="ok">{tr("{p0} dòng hợp lệ · digest {p1}…", { p0: preview.count, p1: preview.digest.slice(0, 16) })}</Callout>
            ) : (
              <Callout tone="danger" title={tr("{p0} dòng có lỗi — sửa CSV rồi xem trước lại", { p0: preview.errors.length })}>
                <ul className="list-disc pl-4">
                  {preview.errors.map((e) => (
                    <li key={e.row}>
                      {tr("Dòng {p0}", { p0: e.row })}: {e.messages.join("; ")}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        <DialogFooter>
          <Button disabled={locked} variant="ghost" onClick={() => onOpenChange(false)}>{tr("Hủy")}</Button>
          {preview?.canApply ? (
            <CommandForm onLockChange={setLocked} onOpenChange={o=>{if(!o){reset();onOpenChange(false);}}} title={tr("Áp dụng CSV đã xem trước")} endpoint="POST /enterprise-workspace/products-import/apply" schema={emptySchema} defaultValues={{}} submitLabel={tr("Áp dụng {p0} sản phẩm", {p0:preview.count})} invalidate={[["ws-catalog"]]} run={(_,cmd)=>wapi.applyImport({rows:preview.rows,digest:preview.digest},cmd)} onDone={()=>{setText("");reset();onOpenChange(false);}}>{()=>null}</CommandForm>
          ) : (
            <Button onClick={runPreview} disabled={busy || !text.trim()}>{busy && <Loader2 className="animate-spin" />} {tr("Xem trước")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
