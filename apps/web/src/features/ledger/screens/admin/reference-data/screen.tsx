"use client";

import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { Plus } from "lucide-react";
import { api } from "@/lib/ledger/operations-api";
import type { ReferenceCategory, ReferenceItem } from "@/lib/ledger/operations-types";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { REF_CATEGORY_LABEL } from "@/lib/ledger/labels";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const CATS = Object.keys(REF_CATEGORY_LABEL) as ReferenceCategory[];
const schema = z.object({
  category: z.enum(["UNIT", "PRODUCT_CATEGORY", "CERTIFICATE_TYPE", "LOSS_REASON", "PROCESSING_TYPE", "TICKET_CATEGORY", "VEHICLE_TYPE"]),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{1,40}$/, { error: () => tr("A-Z, 0-9, _ · tối đa 40") }),
  label: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(120),
  description: z.string().max(500).optional(),
  sortOrder: z.coerce.number<number>().int().min(0).max(10000),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

function ReferencePage() {
  return (
    <Guard permission="reference.read">
      <Reference />
    </Guard>
  );
}

function Reference() {
  const { can } = useLedgerSession();
  const [cat, setCat] = useState<ReferenceCategory | "">("");
  const q = useQuery({ queryKey: ["references", cat], queryFn: () => api.config.references(cat || undefined) });
  const edit = useDialog<ReferenceItem | "new">();
  const t = edit.target;
  const item = t && t !== "new" ? t : null;
  const columns: Column<ReferenceItem>[] = [
    { key: "cat", header: tr("Danh mục"), cell: (r) => <span className="text-[12px] text-ink-2">{REF_CATEGORY_LABEL[r.category]}</span> },
    { key: "code", header: tr("Mã"), sort: (r) => r.code, cell: (r) => <span className="font-mono text-[12px]">{r.code}</span> },
    { key: "label", header: tr("Nhãn"), cell: (r) => <span>{r.label}</span> },
    { key: "order", header: tr("Thứ tự"), sort: (r) => r.sortOrder, cell: (r) => <span className="font-mono text-[12px]">{r.sortOrder}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (r) => <Status group="ref" value={r.status} /> },
    { key: "act", headClassName: "relative", header: <span className="sr-only">{tr("Sửa")}</span>, cell: (r) => (can("reference.write") ? <Button size="xs" variant="ghost" onClick={(e) => (e.stopPropagation(), edit.open(r))}>{tr("Sửa")}</Button> : null) },
  ];
  return (
    <>
      <PageHeader
        title={tr("Danh mục tham chiếu")}
        description={tr("Danh mục dùng chung cho doanh nghiệp: đơn vị, nhóm sản phẩm, chứng nhận, lý do hao hụt, loại chế biến, chủ đề hỗ trợ. Không xóa — ngừng dùng bằng trạng thái.")}
        actions={can("reference.write") && <Button size="sm" onClick={() => edit.open("new")}><Plus /> {tr("Thêm mục")}</Button>}
      />
      <PageBody>
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {(["", ...CATS] as const).map((c) => (
            <button key={c || "all"} type="button" onClick={() => setCat(c)} className={cn("h-8 shrink-0 rounded-md border px-3 text-[12.5px] font-medium", cat === c ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {c ? REF_CATEGORY_LABEL[c] : tr("Tất cả")}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(r) => r.id} empty={<EmptyState title={tr("Danh mục trống")} />} dense />
        </div>
      </PageBody>
      {t && (
        <CommandDialog
          {...edit.props}
          title={item ? tr("Sửa {p0}", { p0: item.code }) : tr("Thêm mục danh mục")}
          endpoint="POST /platform-admin/reference-items"
          description={item ? tr("Cập nhật theo (category, code) kèm version hiện tại.") : tr("Mã trùng trong cùng danh mục trả 409.")}
          schema={schema}
          defaultValues={item ? { category: item.category, code: item.code, label: item.label, description: item.description ?? "", sortOrder: item.sortOrder, status: item.status } : { category: cat || "UNIT", code: "", label: "", description: "", sortOrder: 100, status: "ACTIVE" }}
          version={item?.version}
          submitLabel={tr("Lưu")}
          invalidate={[["references"]]}
          run={(v, cmd) => api.config.upsertReference({ ...v, description: v.description || undefined, version: item?.version }, cmd)}
        >
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SelectField control={f.control} name="category" label={tr("Danh mục")} options={CATS.map((c) => ({ value: c, label: REF_CATEGORY_LABEL[c] }))} />
                <TextField control={f.control} name="code" label={tr("Mã")} />
                <TextField control={f.control} name="label" label={tr("Nhãn")} max={120} />
                <TextField control={f.control} name="sortOrder" label={tr("Thứ tự")} type="number" />
              </div>
              <TextAreaField control={f.control} name="description" label={tr("Mô tả")} max={500} rows={2} />
              <ChoiceField control={f.control} name="status" label={tr("Trạng thái")} options={[{ value: "ACTIVE", label: tr("Đang dùng") }, { value: "INACTIVE", label: tr("Ngừng dùng") }]} />
            </>
          )}
        </CommandDialog>
      )}
    </>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-reference-data"><ReferencePage/></LedgerRouteScreen>;}
