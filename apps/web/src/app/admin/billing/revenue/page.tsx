"use client";
import { NativeSelect } from "@/components/ui/native-select";

import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import { BarList, DataTable, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, Section } from "@/components/manage";
import { money, type Row } from "@/lib/platform-admin";

type Revenue = {
  months: Row[];
  byPlan: Row[];
  paidTotal: number;
  simulatedTotal: number;
  outstandingTotal: number;
  overdueTotal: number;
  activeSubscriptions: number;
  expiringIn30Days: number;
  note: string;
};

/** Revenue by month and plan. Simulated payments are listed apart. */
export default function RevenuePage() {
  const [months, setMonths] = useState(12);
  const state = useWorkspaceData<Revenue>(`/platform-billing/revenue?months=${months}`);
  const r = state.data;
  return (
    <ManagePage>
      <PageHeader title="Báo cáo doanh thu" description="Doanh thu đã thu theo tháng và theo gói, công nợ và gói sắp hết hạn." actions={<ReloadButton onClick={state.reload} />} />
      <div className="admin-inline-form manage-section">
        <label className="field">
          Số tháng
          <NativeSelect className="input" value={months} onChange={(e) => setMonths(Number(e.target.value))}>
            {[3, 6, 12, 24].map((m) => <option key={m} value={m}>{m} tháng</option>)}
          </NativeSelect>
        </label>
      </div>
      <LoadState loading={state.loading} error={state.error} />
      {r && (
        <>
          <Metrics
            label="Doanh thu"
            items={[
              { label: "Đã thu (thật)", value: money(r.paidTotal) },
              { label: "Thanh toán mô phỏng", value: money(r.simulatedTotal) },
              { label: "Công nợ", value: money(r.outstandingTotal), href: "/admin/billing/invoices" },
              { label: "Quá hạn", value: money(r.overdueTotal), href: "/admin/billing/invoices" },
              { label: "Gói hiệu lực", value: r.activeSubscriptions, href: "/admin/billing/subscriptions" },
              { label: "Hết hạn trong 30 ngày", value: r.expiringIn30Days, href: "/admin/billing/subscriptions" },
            ]}
          />
          <p className="notice">{r.note}</p>
          <div className="admin-grid-2">
            <Section title="Doanh thu thật theo tháng">
              <BarList label="Doanh thu theo tháng" rows={r.months.map((m) => ({ label: String(m.month), value: Number(m.paid) }))} format={(v) => money(v)} />
            </Section>
            <Section title="Theo gói">
              <DataTable
                label="Doanh thu theo gói"
                rows={r.byPlan}
                rowKey={(p) => String(p.planCode)}
                empty={{ title: "Chưa có thanh toán", description: "Chưa có hóa đơn đã thanh toán trong kỳ." }}
                columns={[
                  { header: "Gói", cell: (p) => String(p.planCode) },
                  { header: "Hóa đơn", cell: (p) => String(p.count) },
                  { header: "Tổng (gồm mô phỏng)", cell: (p) => money(p.amount) },
                ]}
              />
            </Section>
          </div>
        </>
      )}
    </ManagePage>
  );
}
