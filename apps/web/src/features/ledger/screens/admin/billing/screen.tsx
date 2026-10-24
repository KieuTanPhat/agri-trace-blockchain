"use client";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";

import { z } from "zod";
import { api } from "@/lib/ledger/operations-api";
import type { Plan, PlanVersion } from "@/lib/ledger/operations-types";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import { ErrorState, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Code, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const int = (min: number, max: number) => z.coerce.number<number>({ error: () => tr("Nhập số") }).int({ error: () => tr("Số nguyên") }).min(min, `≥ ${min}`).max(max, `≤ ${fmtNumber(max)}`);
const draftSchema = z.object({
  setupFee: int(0, 1e10),
  annualFee: int(0, 1e10),
  termMonths: int(1, 60),
  chains: int(0, 1000),
  members: int(1, 100000),
  products: int(0, 100000),
  qrLabels: int(0, 1e8),
  note: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000),
});
const publishSchema = z.object({ reason: reason() });

function PlansPage() {
  return (
    <Guard permission="billing.read">
      <Plans />
    </Guard>
  );
}

function Plans() {
  const { can } = useLedgerSession();
  const q = useQuery({ queryKey: ["plans"], queryFn: api.billing.plans });
  const draft = useDialog<Plan>();
  const publish = useDialog<PlanVersion>();
  const invalidate = [["plans"], ["approvals"], ["inbox"]];
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const base = draft.target?.versions.find((v) => v.status === "PUBLISHED") ?? draft.target?.versions[0] ?? {setupFee:0,annualFee:0,termMonths:12,limits:{products:5,chains:1,members:10,qrLabels:10000}};

  return (
    <>
      <PageHeader title={tr("Bảng giá dịch vụ")} description={tr("Mỗi phiên bản gói có phí và hạn mức; bản đã công bố là bất biến và báo giá ghi planVersionId.")} />
      <PageBody>
        {!q.data ? (
          <LoadingRows />
        ) : (
          q.data.map((p) => {
            const hasDraft = p.versions.some((v) => v.status === "DRAFT");
            return (
              <Section
                key={p.code}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {p.name} <Code>{p.code}</Code>
                  </span>
                }
                aside={
                  can("billing.write") && (
                    <Button size="xs" variant="outline" disabled={hasDraft} title={hasDraft ? tr("Đã có bản nháp chưa công bố") : undefined} onClick={() => draft.open(p)}>
                      {tr("Tạo phiên bản nháp")}
                    </Button>
                  )
                }
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                        <th className="h-9 px-4 font-semibold">{tr("Phiên bản")}</th>
                        <th className="px-3 text-right font-semibold">{tr("Khởi tạo")}</th>
                        <th className="px-3 text-right font-semibold">{tr("Phí năm")}</th>
                        <th className="px-3 font-semibold">{tr("Hạn mức (chuỗi · thành viên · SP · tem)")}</th>

                        <th className="px-3 font-semibold">{tr("Đang dùng")}</th>
                        <th className="px-4 font-semibold">{tr("Trạng thái")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.versions.map((v) => (
                        <tr key={v.id} className="border-b border-line/70 last:border-0">
                          <td className="h-11 px-4">
                            <span className="font-mono">v{v.version}</span> <span className="text-[12px] text-ink-2">· {v.termMonths} {tr("tháng")}</span>
                          </td>
                          <td className="px-3 text-right font-mono text-[12px]">{fmtMoney(v.setupFee)}</td>
                          <td className="px-3 text-right font-mono text-[12px]">{fmtMoney(v.annualFee)}</td>
                          <td className="px-3 font-mono text-[12px]">{v.limits.chains} · {fmtNumber(v.limits.members)} · {fmtNumber(v.limits.products)} · {fmtNumber(v.limits.qrLabels)}</td>

                          <td className="px-3 font-mono text-[12px]">{v.activeSubscriptions}</td>
                          <td className="px-4">
                            <span className="flex items-center gap-2">
                              <Status group="plan" value={v.status} />
                              {v.status === "PUBLISHED" ? <span className="text-[12px] text-ink-2">{fmtDate(v.publishedAt)}</span> : can("billing.write") && v.status === "DRAFT" && <Button size="xs" onClick={() => publish.open(v)}>{tr("Công bố")}</Button>}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            );
          })
        )}
      </PageBody>

      {draft.target && base && (
        <CommandDialog
          {...draft.props}
          title={tr("Phiên bản nháp · {p0}", { p0: draft.target.name })}
          endpoint="POST /platform-billing/plans/:code/versions"
          description={tr("Bản nháp chưa áp dụng cho báo giá; chỉ có hiệu lực sau khi công bố.")}
          schema={draftSchema}
          defaultValues={{ setupFee: base.setupFee, annualFee: base.annualFee, termMonths: base.termMonths, ...base.limits, note: "" }}
          submitLabel={tr("Lưu bản nháp")}
          invalidate={invalidate}
          wide
          run={(v, cmd) => api.billing.draftVersion(draft.target!.code, { setupFee: v.setupFee, annualFee: v.annualFee, termMonths: v.termMonths, limits: { chains: v.chains, members: v.members, products: v.products, qrLabels: v.qrLabels }, note: v.note }, cmd)}
        >
          {(f) => (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <TextField control={f.control} name="setupFee" label={tr("Phí khởi tạo (VND)")} type="number" />
                <TextField control={f.control} name="annualFee" label={tr("Phí năm (VND)")} type="number" />
                <TextField control={f.control} name="termMonths" label={tr("Kỳ hạn (tháng)")} type="number" />
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <TextField control={f.control} name="chains" label={tr("Chuỗi")} type="number" />
                <TextField control={f.control} name="members" label={tr("Thành viên")} type="number" />
                <TextField control={f.control} name="products" label={tr("Sản phẩm")} type="number" />
                <TextField control={f.control} name="qrLabels" label="Tem QR" type="number" />
              </div>

              <TextAreaField control={f.control} name="note" label={tr("Ghi chú thay đổi")} hint={tr("10–1000 ký tự")} />
            </>
          )}
        </CommandDialog>
      )}
      {publish.target && (
        <CommandDialog
          {...publish.props}
          title={tr("Công bố {p0} v{p1}", { p0: publish.target.planCode, p1: publish.target.version })}
          endpoint="POST /platform-billing/plan-versions/:id/publish"
          description={tr("Bản đã công bố là bất biến. Khi ENFORCED phải qua đề xuất PLAN_VERSION_PUBLISH.")}
          schema={publishSchema}
          defaultValues={{ reason: "" }}
          submitLabel={tr("Công bố")}
          invalidate={invalidate}
          proposal={{ operation: "PLAN_VERSION_PUBLISH", params: () => ({ versionId: publish.target!.id }), reason: (v) => v.reason }}
          run={(v, cmd) => api.billing.publishVersion(publish.target!.id, v, cmd)}
        >
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do công bố")} />}
        </CommandDialog>
      )}
    </>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-billing"><PlansPage/></LedgerRouteScreen>;}
