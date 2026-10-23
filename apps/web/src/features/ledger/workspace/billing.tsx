"use client";

import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { z } from "zod";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import type { Invoice } from "@/lib/ledger/platform-api";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/ledger/format";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { SelectField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, Field, Fields, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const renewSchema = z.object({ planCode: z.string().min(1, { error: () => tr("Chọn gói") }) });

export default function WsBillingPage() {
  const { primary } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["ws-billing"], queryFn: wapi.billing });
  const renew = useDialog();
  const pay = useDialog<Invoice>();
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={6} className="p-8" />;
  const b = q.data;
  const s = b.subscription;
  const invalidate = [["ws-billing"], ["invoices"], ["subscriptions"], ["revenue"]];
  return (
    <>
      <PageHeader
        title={tr("Gói dịch vụ & hóa đơn")}
        description={b.paying ? tr("Doanh nghiệp trả phí theo gói. Hết hạn sẽ qua giai đoạn ân hạn rồi bị hạn chế tạo mới (giao nhận đang dở và trang QR công khai không bị chặn).") : tr("Doanh nghiệp tham gia miễn phí theo hạn mức chung của nền tảng.")}
        meta={<Status group="subscription" value={b.status === "PARTICIPANT" ? "FREE" : b.status} />}
        actions={
          primary && b.paying && s && (
            <Button size="sm" onClick={() => renew.open(true)}>
              {tr("Gia hạn gói")}
            </Button>
          )
        }
      />
      <PageBody className="min-w-0">
        {s && (
          <Section title={tr("Gói hiện tại")}>
            <Fields cols={4}>
              <Field label={tr("Gói")}>{s.planName} <span className="font-mono text-[12px] text-ink-2">v{s.planVersion.version}</span></Field>
              <Field label={tr("Phí năm")}>{fmtMoney(s.planVersion.annualFee)}</Field>
              <Field label={tr("Kết thúc")}>{fmtDate(s.endsAt)}{s.daysRemaining !== null && <span className="text-ink-2"> ({s.daysRemaining} {tr("ngày)")}</span>}</Field>
              <Field label={tr("Hết ân hạn")}>{fmtDate(s.graceEndsAt)}</Field>
            </Fields>
          </Section>
        )}
        <Section title={tr("Mức sử dụng")} aside={b.paying ? tr("Theo hạn mức gói") : "Theo billing.participantLimits"}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-4 py-4 sm:grid-cols-4 sm:px-5">
            {(["members", "products", "chains", "qrLabels"] as const).map((k) => {
              const lim = b.limits?.[k];
              const used = b.usage[k] ?? 0;
              const pct = lim ? Math.min(100, (used / lim) * 100) : 0;
              return (
                <div key={k} className="flex flex-col gap-1.5 text-[12px]">
                  <span className="text-ink-2">{{ members: tr("Thành viên"), products: tr("Sản phẩm"), chains: tr("Chuỗi"), qrLabels: tr("Tem QR trong kỳ") }[k]}</span>
                  <span className="font-mono text-[14px]">
                    {fmtNumber(used)} / {lim === undefined ? "—" : fmtNumber(lim)}
                  </span>
                  <div className="h-1.5 rounded-full bg-sunken" aria-hidden>
                    <div className={cn("h-full rounded-full", pct >= 90 ? "bg-danger" : pct >= 70 ? "bg-warn-dot" : "bg-brand")} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
        <Section title={tr("Hóa đơn")}>
          {b.invoices.length ? (
            <ul className="divide-y divide-line/70">
              {b.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5">
                  <span className="font-mono">{i.number}</span>
                  <span className="text-ink-2">
                    {i.kind === "INITIAL" ? tr("Khởi tạo") : tr("Gia hạn")} {tr("· hạn")} {fmtDate(i.dueAt)}
                  </span>
                  <span className="font-mono">{fmtMoney(i.amount)}</span>
                  <span className="flex items-center gap-2">
                    <Status group="invoice" value={i.status} />
                    {i.simulated && <Badge tone="warn" dot={false}>{tr("mô phỏng")}</Badge>}
                    {primary && i.status === "ISSUED" && b.simulationEnabled && (
                      <Button size="xs" variant="outline" onClick={() => pay.open(i)}>
                        {tr("Thanh toán mô phỏng")}
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={tr("Chưa có hóa đơn")} />
          )}
        </Section>
        <Callout>{tr("Cổng thanh toán thật (SePay/NAPAS) chưa tích hợp trong Backend: chỉ có thanh toán mô phỏng ở môi trường local hoặc nền tảng xác nhận chuyển khoản.")}</Callout>
      </PageBody>
      {s && (
        <CommandDialog
          {...renew.props}
          title={tr("Gia hạn gói dịch vụ")}
          endpoint="POST /enterprise-billing/renewals"
          description={tr("Khi kỳ đã trả còn hiệu lực chỉ gia hạn được cùng gói. Hóa đơn gia hạn nối tiếp từ ngày hết hạn hiện tại.")}
          schema={renewSchema}
          defaultValues={{ planCode: s.planCode }}
          submitLabel={tr("Tạo hóa đơn gia hạn")}
          invalidate={invalidate}
          run={(v, cmd) => wapi.renew(v, cmd)}
        >
          {(f) => <SelectField control={f.control} name="planCode" label={tr("Gói")} options={b.plans.map((p) => ({ value: p.code, label: tr("{p0} · {p1}/năm", { p0: p.name, p1: fmtMoney(p.version.annualFee) }) }))} />}
        </CommandDialog>
      )}
      {pay.target && (
        <CommandDialog
          {...pay.props}
          title={tr("Thanh toán mô phỏng {p0}", { p0: pay.target.number })}
          endpoint="POST /enterprise-billing/invoices/:id/payment-simulation"
          description={tr("Số tiền {p0}. Chỉ dùng trong môi trường local; doanh thu mô phỏng không được tính là tiền thật.", { p0: fmtMoney(pay.target.amount) })}
          schema={z.object({})}
          defaultValues={{}}
          version={pay.target.version}
          submitLabel={tr("Thanh toán mô phỏng")}
          invalidate={invalidate}
          run={(_, cmd) => wapi.paySimulated(pay.target!.id, { version: pay.target!.version }, cmd)}
        >
          {() => null}
        </CommandDialog>
      )}
    </>
  );
}
