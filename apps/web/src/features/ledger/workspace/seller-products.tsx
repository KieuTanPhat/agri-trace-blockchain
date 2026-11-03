"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { distApi } from "@/lib/ledger/dist-api";
import { chainApi } from "@/lib/ledger/chain-api";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { Input } from "@/components/ledger/ui/input";
import { procApi } from "@/lib/ledger/proc-api";
import { ledgerRequest } from "@/lib/ledger/request";
import { newLedgerCommandKey, type LedgerCommandContext } from "@/lib/ledger/command-context";
import type { StockLot } from "@/lib/ledger/dist-types";
import type { Product } from "@/lib/ledger/product-types";
import { fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

/** One product the business sells, built from the lots it received. */
type Selling = { productId: string; productName: string; producerName: string | null; unit: string; available: number; lots: StockLot[]; external: boolean };
const QTY = /^\d{1,11}(\.\d{1,3})?$/;

/**
 * Retail and distribution products. "Hàng đang bán" lists what the business
 * received, grouped by product, with no manual entry; a received product can
 * become the source of a private label, which is packed from those lots into
 * branded lots with their own QR while keeping the source in the lineage.
 */
export function SellerProducts({ own, onOpen }: { own: Product[]; onOpen: (id: string) => void }) {
  const { can } = useWorkspaceAccess();
  const me = useOverview().data?.organization;
  const report = useQuery({ queryKey: ["dist-report", "selling"], queryFn: () => distApi.report({}) });
  const makeLabel = useDialog<Selling>();
  const intake = useDialog();
  const pack = useDialog<Product>();
  const selling = useMemo(() => {
    const map = new Map<string, Selling>();
    for (const lot of report.data?.lots ?? []) {
      if (!lot.productId || lot.privateLabel || Number(lot.held) <= 0) continue;
      // Own lots count only when they are goods recorded from an outside supplier.
      if (lot.farmOrgId === me?.id && !lot.externalGoods) continue;
      const row = map.get(lot.productId) ?? { productId: lot.productId, productName: lot.productName, producerName: lot.externalGoods ? tr("Nhập ngoài AgriTrace") : lot.producerName ?? null, unit: lot.unit, available: 0, lots: [], external: !!lot.externalGoods };
      row.available += Number(lot.available);
      row.lots.push(lot);
      map.set(lot.productId, row);
    }
    return [...map.values()].sort((a, b) => a.productName.localeCompare(b.productName, "vi"));
  }, [report.data, me?.id]);
  const labels = own.filter((p) => p.privateLabel);
  const columns: Column<Selling>[] = [
    { key: "name", header: tr("Sản phẩm"), cell: (s) => <span className="font-medium">{s.productName}</span> },
    { key: "producer", header: tr("Nhà sản xuất"), hideBelow: "md", cell: (s) => <span className="text-[12.5px]">{s.producerName ?? "—"}</span> },
    { key: "available", header: tr("Khả dụng"), cell: (s) => <span className="font-mono text-[12.5px]">{fmtNumber(s.available)} {s.unit}</span> },
    { key: "lots", header: tr("Lô"), hideBelow: "md", cell: (s) => <span className="flex flex-wrap gap-1">{s.lots.map((l) => l.traceToken ? <Link key={l.lotId} href={`/trace/${l.traceToken}`} className="font-mono text-[11.5px] text-brand underline">{l.lotCode}</Link> : <span key={l.lotId} className="font-mono text-[11.5px]">{l.lotCode}</span>)}</span> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (s) => can("catalog.manage") && !s.external ? <Button size="xs" variant="outline" onClick={() => makeLabel.open(s)}>{tr("Làm nhãn riêng")}</Button> : null },
  ];
  return (
    <>
      <Section title={tr("Hàng đang bán")} aside={can("processing.write") && <Button size="xs" variant="outline" onClick={() => intake.open(true)}>{tr("Nhập hàng ngoài AgriTrace")}</Button>} bodyClassName="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] text-ink-2">{tr("Tự lấy từ các lô doanh nghiệp đã nhận bàn giao. Thông tin nguồn gốc do nhà sản xuất ghi, bên bán không sửa.")}</p>
        <div className="overflow-hidden rounded-md border border-line">
          <DataTable rows={selling} loading={report.isLoading} error={report.error} onRetry={() => report.refetch()} columns={columns} rowKey={(s) => s.productId} empty={<EmptyState title={tr("Chưa nhận lô hàng nào")} />} />
        </div>
      </Section>
      <Section title={tr("Nhãn riêng")} bodyClassName="flex flex-col gap-3 p-4">
        <p className="text-[12.5px] text-ink-2">{tr("Hàng của nhà sản xuất bán dưới thương hiệu của bạn: đóng gói từ lô đã nhận thành lô mới có QR riêng; khách quét vẫn thấy nguồn gốc thật. Sản phẩm nhãn riêng cần ảnh và hoàn tất trước khi đóng gói.")}</p>
        {labels.length === 0 ? <p className="text-[12.5px] text-ink-2">{tr("Chưa có nhãn riêng. Bấm \"Làm nhãn riêng\" ở hàng đang bán.")}</p> : (
          <ul className="divide-y divide-line/70 rounded-md border border-line">
            {labels.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1"><span className="font-medium">{p.productName}</span><span className="block text-[12px] text-ink-2">{tr("Nguồn: {p0}", { p0: (p.labelSourceIds ?? []).map((id) => selling.find((s) => s.productId === id)?.productName ?? id.slice(0, 8)).join(", ") })}</span></span>
                <Badge tone={p.status === "ACTIVE" ? "ok" : "neutral"}>{p.status === "ACTIVE" ? tr("Đang bán") : tr("Chờ ảnh và hoàn tất")}</Badge>
                <Button size="xs" variant="outline" onClick={() => onOpen(p.id)}>{tr("Chi tiết")}</Button>
                {p.status === "ACTIVE" && can("processing.write") && <Button size="xs" onClick={() => pack.open(p)}>{tr("Đóng gói nhãn riêng")}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {intake.target && <OutsideIntake goods={own.filter((p) => p.externalGoods)} props={intake.props} />}
      {makeLabel.target && <MakeLabel source={makeLabel.target} brand={me?.name ?? ""} props={makeLabel.props} onCreated={onOpen} />}
      {pack.target && <PackLabel product={pack.target} lots={(report.data?.lots ?? []).filter((l) => l.productId && (pack.target!.labelSourceIds ?? []).includes(l.productId) && Number(l.available) > 0 && !l.blocked)} props={pack.props} />}
    </>
  );
}

const labelSchema = z.object({
  productName: z.string().trim().min(1).max(255),
  category: z.string().trim().min(2).max(100),
  defaultUnit: z.string().trim().min(1).max(30),
  storageConditions: z.string().trim().min(2).max(2000),
  ingredients: z.string().trim().min(2).max(2000),
  usageInstructions: z.string().trim().min(2).max(2000),
  description: z.string().max(2000).optional(),
});

function MakeLabel({ source, brand, props, onCreated }: { source: Selling; brand: string; props: { open: boolean; onOpenChange: (o: boolean) => void }; onCreated: (id: string) => void }) {
  return (
    <CommandDialog {...props} title={tr("Làm nhãn riêng từ {p0}", { p0: source.productName })} endpoint="POST /catalog/products"
      description={tr("Sản phẩm mang thương hiệu của bạn, nguồn là {p0}. Sau khi tạo, tải ảnh sản phẩm và bấm hoàn tất để đóng gói.", { p0: source.producerName ?? source.productName })}
      schema={labelSchema}
      defaultValues={{ productName: `${source.productName} — ${brand}`, category: tr("Nông sản"), defaultUnit: source.unit, storageConditions: tr("Theo hướng dẫn của nhà sản xuất"), ingredients: source.productName, usageInstructions: tr("Theo hướng dẫn của nhà sản xuất"), description: "" }}
      submitLabel={tr("Tạo nhãn riêng")} invalidate={[["ws-catalog"]]}
      run={(v, cmd) => createLabel({ ...v, description: v.description || undefined, privateLabelSourceIds: [source.productId] }, cmd)}
      onDone={(result) => { const id = (result as { id?: string } | undefined)?.id; if (id) onCreated(id); }}>
      {(f) => (
        <>
          <TextField control={f.control} name="productName" label={tr("Tên sản phẩm nhãn riêng")} />
          <TextField control={f.control} name="category" label={tr("Nhóm hàng")} />
          <TextField control={f.control} name="defaultUnit" label={tr("Đơn vị")} />
          <TextAreaField control={f.control} name="storageConditions" label={tr("Bảo quản")} />
          <TextAreaField control={f.control} name="ingredients" label={tr("Thành phần")} />
          <TextAreaField control={f.control} name="usageInstructions" label={tr("Hướng dẫn sử dụng")} />
          <TextAreaField control={f.control} name="description" label={tr("Câu chuyện thương hiệu (hiện khi khách quét QR, sau khi được duyệt)")} />
        </>
      )}
    </CommandDialog>
  );
}

const createLabel = (input: z.infer<typeof labelSchema> & { privateLabelSourceIds?: string[]; externalGoods?: boolean }, cmd: LedgerCommandContext) =>
  ledgerRequest<{ id: string }>("/catalog/products", { method: "POST", headers: { "Idempotency-Key": cmd.idempotencyKey }, body: JSON.stringify(input) });

/**
 * Packs received lots into a branded lot: a PACKING run is planned, started and
 * completed. A step that fails leaves the run open; packing again resumes it.
 */
function PackLabel({ product, lots, props }: { product: Product; lots: StockLot[]; props: { open: boolean; onOpenChange: (o: boolean) => void } }) {
  const options = lots.flatMap((l) => l.siteHoldings.filter((s) => Number(s.available) > 0).map((s) => ({ value: `${l.lotId}|${s.siteId}`, label: `${l.lotCode} · ${l.productName} · ${s.siteName} · ${s.available} ${l.unit}` })));
  const schema = z.object({
    source: z.string().min(1, { error: () => tr("Chọn lô nguồn") }),
    quantity: z.string().regex(QTY, { error: () => tr("Tối đa 3 chữ số thập phân") }).refine((v) => Number(v) > 0, { error: () => tr("Lớn hơn 0") }),
    packaging: z.string().trim().min(1).max(255),
    packageCount: z.string().regex(/^\d{1,7}$/, { error: () => tr("Số nguyên") }),
    expiryDate: z.string().optional(),
  });
  if (!options.length) return <CommandDialog {...props} title={tr("Đóng gói nhãn riêng")} endpoint="POST /processing-runs" schema={z.object({})} defaultValues={{}} submitLabel={tr("Đóng")} run={async () => null}>{() => <Callout tone="info">{tr("Chưa có lô nguồn nào đang giữ để đóng gói.")}</Callout>}</CommandDialog>;
  return (
    <CommandDialog {...props} title={tr("Đóng gói {p0}", { p0: product.productName })} endpoint="POST /processing-runs"
      description={tr("Lấy lượng từ lô nguồn đã nhận, tạo lô nhãn riêng với QR mới. Lượng đóng gói không vượt lượng đang giữ.")}
      schema={schema} defaultValues={{ source: options[0].value, quantity: "", packaging: tr("Túi"), packageCount: "1", expiryDate: "" }}
      submitLabel={tr("Đóng gói")} invalidate={[["dist-report"], ["ws-catalog"], ["ws-lots"]]}
      run={async (v) => {
        const [lotId, siteId] = v.source.split("|");
        const lot = lots.find((l) => l.lotId === lotId)!;
        if (!lot.chainId) throw new Error(tr("Lô nguồn chưa thuộc chuỗi nào"));
        const key = () => ({ idempotencyKey: newLedgerCommandKey() });
        const run = await procApi.create({ chainId: lot.chainId, siteId, productId: product.id, processType: "PACKING", baseUnit: lot.unit, inputs: [{ lotId, quantity: v.quantity }], externalInputs: [] }, key());
        const started = await procApi.start(run.id, { version: run.version }, key());
        return procApi.complete(run.id, { version: started.version, output: { quantity: v.quantity, unit: lot.unit, packaging: v.packaging, packageCount: Number(v.packageCount), ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}) }, byProducts: [], losses: [] }, key());
      }}>
      {(f) => (
        <>
          <SelectField control={f.control} name="source" label={tr("Lô nguồn")} options={options} />
          <TextField control={f.control} name="quantity" label={tr("Lượng đóng gói")} inputMode="decimal" />
          <TextField control={f.control} name="packaging" label={tr("Quy cách")} />
          <TextField control={f.control} name="packageCount" label={tr("Số gói")} inputMode="numeric" />
          <TextField control={f.control} name="expiryDate" label={tr("Hạn dùng (không bắt buộc)")} type="date" />
        </>
      )}
    </CommandDialog>
  );
}

/**
 * Goods bought from a supplier outside AgriTrace, recorded from its documents:
 * the receipt (document photo required, supplier lot code optional) becomes a
 * lot of the business through a packing run, so it is sold, recalled and
 * scanned like any lot. Each step that fails can be resent; the receipt stays.
 */
function OutsideIntake({ goods, props }: { goods: Product[]; props: { open: boolean; onOpenChange: (o: boolean) => void } }) {
  const suppliers = useQuery({ queryKey: ["ws-external-partners"], queryFn: wapi.externalPartners });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites });
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: chainApi.chains });
  const me = useOverview().data?.organization.id;
  const [file, setFile] = useState<File | null>(null);
  // Outside goods are recorded in the business's own store ledger, not a chain.
  const ledger = (chains.data ?? []).find((c) => c.personal && c.ownerOrganizationId === me);
  const schema = z.object({
    supplierId: z.string().min(1, { error: () => tr("Chọn nhà cung cấp") }),
    goods: z.string().min(1, { error: () => tr("Chọn hoặc nhập tên hàng") }),
    newName: z.string().max(255).optional(),
    siteId: z.string().min(1, { error: () => tr("Chọn cơ sở nhận") }),
    documentNo: z.string().trim().min(1).max(100),
    supplierLotCode: z.string().trim().max(60).optional(),
    receivedAt: z.string().min(1),
    quantity: z.string().regex(QTY, { error: () => tr("Tối đa 3 chữ số thập phân") }).refine((v) => Number(v) > 0, { error: () => tr("Lớn hơn 0") }),
    unit: z.string().trim().min(1).max(30),
    expiryDate: z.string().optional(),
  }).refine((v) => v.goods !== "new" || !!v.newName?.trim(), { path: ["newName"], error: () => tr("Nhập tên hàng") });
  return (
    <CommandDialog {...props} wide title={tr("Nhập hàng ngoài AgriTrace")} endpoint="POST /processing-runs/receipts"
      description={tr("Ghi hàng mua của nhà cung cấp chưa dùng AgriTrace theo hóa đơn hoặc phiếu giao. Bắt buộc ảnh chứng từ. Mã lô in trên chứng từ (nếu có) giúp nối về lô gốc khi hàng từng đi ra từ AgriTrace.")}
      schema={schema}
      defaultValues={{ supplierId: "", goods: goods[0]?.id ?? "new", newName: "", siteId: (sites.data ?? []).find((x) => x.status === "ACTIVE")?.id ?? "", documentNo: "", supplierLotCode: "", receivedAt: new Date().toISOString().slice(0, 10), quantity: "", unit: "kg", expiryDate: "" }}
      submitLabel={tr("Nhập kho")} invalidate={[["dist-report"], ["ws-catalog"]]}
      run={async (v) => {
        if (!file) throw new Error(tr("Chọn ảnh hóa đơn hoặc phiếu giao"));
        if (!ledger) throw new Error(tr("Doanh nghiệp chưa có sổ ghi cửa hàng; liên hệ hỗ trợ nền tảng."));
        const key = () => ({ idempotencyKey: newLedgerCommandKey() });
        const supplier = suppliers.data?.find((x) => x.id === v.supplierId);
        const productId = v.goods !== "new" ? v.goods : (await createLabel({ productName: v.newName!.trim(), category: tr("Hàng nhập"), defaultUnit: v.unit, storageConditions: tr("Theo hướng dẫn của nhà cung cấp"), ingredients: v.newName!.trim(), usageInstructions: tr("Theo hướng dẫn của nhà cung cấp"), externalGoods: true }, key())).id;
        const receipt = await procApi.createReceipt({ siteId: v.siteId, materialName: goods.find((g) => g.id === productId)?.productName ?? v.newName!.trim(), supplierId: v.supplierId, documentNo: v.documentNo, ...(v.supplierLotCode ? { supplierLotCode: v.supplierLotCode } : {}), receivedAt: new Date(v.receivedAt + "T00:00:00").toISOString(), quantity: v.quantity, unit: v.unit, ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}) }, key());
        await wapi.uploadEvidence({ file, entityType: "MATERIAL_RECEIPT", entityId: receipt.id, kind: "INVOICE", description: tr("Chứng từ nhập hàng của {p0}", { p0: supplier?.name ?? "" }) }, key());
        const run = await procApi.create({ chainId: ledger.id, siteId: v.siteId, productId, processType: "PACKING", baseUnit: v.unit, inputs: [], externalInputs: [{ receiptId: receipt.id, quantity: v.quantity }] }, key());
        const started = await procApi.start(run.id, { version: run.version }, key());
        return procApi.complete(run.id, { version: started.version, output: { quantity: v.quantity, unit: v.unit, ...(v.expiryDate ? { expiryDate: v.expiryDate } : {}) }, byProducts: [], losses: [] }, key());
      }}>
      {(f) => (
        <>
          {!(suppliers.data ?? []).length && <Callout tone="warn">{tr("Thêm nhà cung cấp vào danh bạ ở Quản lý đối tác trước.")}</Callout>}
          <SelectField control={f.control} name="supplierId" label={tr("Nhà cung cấp (danh bạ đối tác)")} options={(suppliers.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          <SelectField control={f.control} name="goods" label={tr("Hàng")} options={[...goods.map((g) => ({ value: g.id, label: g.productName })), { value: "new", label: tr("Hàng mới…") }]} />
          <TextField control={f.control} name="newName" label={tr("Tên hàng mới (nếu chọn Hàng mới)")} />
          <SelectField control={f.control} name="siteId" label={tr("Cơ sở nhận")} options={(sites.data ?? []).filter((x) => x.status === "ACTIVE").map((x) => ({ value: x.id, label: x.name }))} />
          <TextField control={f.control} name="documentNo" label={tr("Số hóa đơn / phiếu giao")} />
          <TextField control={f.control} name="supplierLotCode" label={tr("Mã lô trên chứng từ hoặc thùng (nếu có)")} />
          <TextField control={f.control} name="receivedAt" label={tr("Ngày nhận")} type="date" />
          <TextField control={f.control} name="quantity" label={tr("Số lượng")} inputMode="decimal" />
          <TextField control={f.control} name="unit" label={tr("Đơn vị")} />
          <TextField control={f.control} name="expiryDate" label={tr("Hạn dùng (không bắt buộc)")} type="date" />
          <label className="flex flex-col gap-1.5 text-sm">{tr("Ảnh hóa đơn hoặc phiếu giao")} *<Input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        </>
      )}
    </CommandDialog>
  );
}
