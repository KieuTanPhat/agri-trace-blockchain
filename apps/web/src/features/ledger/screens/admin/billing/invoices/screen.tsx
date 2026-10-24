"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { MoreHorizontal } from "lucide-react";
import { api } from "@/lib/ledger/operations-api";
import type { Invoice } from "@/lib/ledger/operations-types";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtDateTime, fmtMoney } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ledger/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
import { TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const confirmSchema = z.object({ reference: z.string().trim().min(4, { error: () => tr("Tối thiểu 4 ký tự") }).max(120), reason: reason() });
const voidSchema = z.object({ reason: reason() });

function InvoicesPage() {
  return (
    <Guard permission="billing.read">
      <Suspense>
        <Invoices />
      </Suspense>
    </Guard>
  );
}

function Invoices() {
  const params = useSearchParams();
  const { can } = useLedgerSession();
  const [status, setStatus] = useState("");
  const [organizationId, setOrg] = useState(params.get("organizationId") ?? "");
  const [detailId, setDetail] = useState<string | null>(params.get("id"));
  const q = useQuery({ queryKey: ["invoices", status, organizationId], queryFn: () => api.billing.invoices({ status: status || undefined, organizationId: organizationId || undefined }) });
  const orgs = useQuery({ queryKey: ["directory", {}], queryFn: () => api.enterprises.directory({}) });
  const act = useDialog<{ kind: "confirm" | "void"; inv: Invoice }>();
  const detail = q.data?.find((i) => i.id === detailId) ?? null;
  const invalidate = [["invoices"], ["revenue"], ["subscriptions"], ["inbox"], ["organization"], ["enrollment"], ["enrollments"]];

  const columns: Column<Invoice>[] = [
    { key: "no", header: tr("Số hóa đơn"), sort: (i) => i.number, cell: (i) => <span className="font-mono">{i.number}</span> },
    { key: "org", header: tr("Tổ chức"), cell: (i) => <span className="truncate">{i.organizationName}</span> },
    { key: "kind", header: tr("Loại"), hideBelow: "md", cell: (i) => <span className="text-ink-2">{i.kind === "INITIAL" ? tr("Khởi tạo") : tr("Gia hạn")}{i.simulated && tr(" · mô phỏng")}</span> },
    { key: "amount", header: tr("Số tiền"), sort: (i) => i.amount, className: "text-right", headClassName: "text-right", cell: (i) => <span className="font-mono">{fmtMoney(i.amount)}</span> },
    { key: "due", header: tr("Hạn"), sort: (i) => i.dueAt, cell: (i) => <span className={i.overdue ? "font-medium text-danger" : "font-mono text-[12px]"}>{fmtDate(i.dueAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (i) => <span className="flex gap-1"><Status group="invoice" value={i.status} />{i.overdue && <Badge tone="danger" dot={false}>{tr("Quá hạn")}</Badge>}</span> },
    {
      key: "act",
      headClassName: "relative", header: <span className="sr-only">{tr("Thao tác")}</span>,
      className: "w-10",
      cell: (i) =>
        can("billing.write") && i.status === "ISSUED" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={tr("Thao tác hóa đơn {p0}", { p0: i.number })} onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onSelect={() => act.open({ kind: "confirm", inv: i })}>{tr("Xác nhận đã chuyển khoản")}</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => act.open({ kind: "void", inv: i })}>{tr("Hủy hóa đơn")}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null,
    },
  ];
  const a = act.target;

  return (
    <>
      <PageHeader title={tr("Hóa đơn")} description={tr("Hóa đơn chỉ đi ISSUED → PAID | VOID. Mỗi mã giao dịch nhà cung cấp chỉ thanh toán một hóa đơn. Hủy hóa đơn khởi tạo sẽ phát hành ngay hóa đơn thay thế.")} />
      <PageBody>
        <FilterBar active={!!(status || organizationId)} onReset={() => (setStatus(""), setOrg(""))}>
          <FilterSelect label={tr("Trạng thái")} value={status} onChange={setStatus} options={[{ value: "ISSUED", label: tr("Chờ thanh toán") }, { value: "OVERDUE", label: tr("Quá hạn") }, { value: "PAID", label: tr("Đã thanh toán") }, { value: "VOID", label: tr("Đã hủy") }]} />
          <FilterSelect label={tr("Tổ chức")} value={organizationId} onChange={setOrg} options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.name }))} className="min-w-[220px]" />
        </FilterBar>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(i) => i.id} onRowClick={(i) => setDetail(i.id)} selectedKey={detailId} empty={<EmptyState title={tr("Không có hóa đơn")} />} />
        </div>
      </PageBody>

      <Sheet open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">{detail.number}</SheetTitle>
                <SheetDescription>
                  <Link className="text-brand hover:underline" href={`/admin/directory/${detail.organizationId}`}>{detail.organizationName}</Link>
                </SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-6 text-[13px]">
                <div className="flex gap-1.5"><Status group="invoice" value={detail.status} />{detail.overdue && <Badge tone="danger" dot={false}>{tr("Quá hạn")}</Badge>}{detail.simulated && <Badge tone="warn" dot={false}>{tr("Mô phỏng")}</Badge>}</div>
                <table className="w-full">
                  <tbody>
                    {detail.lines.map((l, i) => (
                      <tr key={i} className="border-b border-line/70"><td className="py-2">{l.label}</td><td className="py-2 text-right font-mono">{fmtMoney(l.amount)}</td></tr>
                    ))}
                    <tr><td className="py-2 font-semibold">{tr("Tổng")}</td><td className="py-2 text-right font-mono font-semibold">{fmtMoney(detail.amount)}</td></tr>
                  </tbody>
                </table>
                <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-y-1.5">
                  <dt className="text-ink-2">{tr("Phát hành")}</dt><dd className="font-mono text-[12px]">{fmtDateTime(detail.issuedAt)}</dd>
                  <dt className="text-ink-2">{tr("Hạn")}</dt><dd className="font-mono text-[12px]">{fmtDateTime(detail.dueAt)}</dd>
                  <dt className="text-ink-2">{tr("Thanh toán")}</dt><dd className="font-mono text-[12px]">{fmtDateTime(detail.paidAt)}</dd>
                  <dt className="text-ink-2">{tr("Nhà cung cấp")}</dt><dd>{detail.provider ?? "—"}</dd>
                  <dt className="text-ink-2">{tr("Mã giao dịch")}</dt><dd className="font-mono text-[12px]">{detail.providerReference ?? "—"}</dd>
                  {detail.voidReason && (<><dt className="text-ink-2">{tr("Lý do hủy")}</dt><dd>{detail.voidReason}</dd></>)}
                  <dt className="text-ink-2">version</dt><dd className="font-mono text-[12px]">{detail.version}</dd>
                </dl>
                {can("billing.write") && detail.status === "ISSUED" && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => act.open({ kind: "confirm", inv: detail })}>{tr("Xác nhận chuyển khoản")}</Button>
                    <Button size="sm" variant="outline" onClick={() => act.open({ kind: "void", inv: detail })}>{tr("Hủy hóa đơn")}</Button>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {a?.kind === "confirm" && (
        <CommandDialog
          {...act.props}
          title={tr("Xác nhận thanh toán {p0}", { p0: a.inv.number })}
          endpoint="POST /platform-billing/invoices/:id/confirm-payment"
          description={tr("Số tiền {p0}. Xác nhận khoản thu đã đối soát; trạng thái thuê bao và dịch vụ do API quyết định. Khi ENFORCED phải qua đề xuất INVOICE_CONFIRM_PAYMENT.", { p0: fmtMoney(a.inv.amount) })}
          schema={confirmSchema}
          defaultValues={{ reference: "", reason: "" }}
          version={a.inv.version}
          submitLabel={tr("Xác nhận đã thu")}
          invalidate={invalidate}
          proposal={{ operation: "INVOICE_CONFIRM_PAYMENT", params: (v) => ({ invoiceId: a.inv.id, version: a.inv.version, reference: v.reference }), reason: (v) => v.reason }}
          run={(v, cmd) => api.billing.confirmPayment(a.inv.id, { ...v, version: a.inv.version }, cmd)}
        >
          {(f) => (
            <>
              <TextField control={f.control} name="reference" label={tr("Mã giao dịch ngân hàng")} max={120} hint={tr("Mỗi mã chỉ dùng cho một hóa đơn")} />
              <TextAreaField control={f.control} name="reason" label={tr("Căn cứ xác nhận")} />
            </>
          )}
        </CommandDialog>
      )}
      {a?.kind === "void" && (
        <CommandDialog {...act.props} title={tr("Hủy hóa đơn {p0}", { p0: a.inv.number })} endpoint="POST /platform-billing/invoices/:id/void" description={a.inv.kind === "INITIAL" ? tr("Hóa đơn khởi tạo: hệ thống phát hành ngay hóa đơn thay thế theo phiên bản gói trong hợp đồng, gói vẫn chờ thanh toán.") : tr("Hủy là thao tác một người, cần lý do.")} schema={voidSchema} defaultValues={{ reason: "" }} version={a.inv.version} tone="danger" submitLabel={tr("Hủy hóa đơn")} invalidate={invalidate} run={(v, cmd) => api.billing.voidInvoice(a.inv.id, { ...v, version: a.inv.version }, cmd)}>
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do hủy")} />}
        </CommandDialog>
      )}
    </>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-billing-invoices"><InvoicesPage/></LedgerRouteScreen>;}
