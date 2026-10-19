"use client";

import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, DetailList, LoadState, ManagePage, PageHeader, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { invoiceLabels, label, money, resourceLabels, shortDate, subscriptionLabels, type Row } from "@/lib/platform-admin";

type Billing = {
  applies: boolean;
  paying: boolean;
  status: string;
  limits: Record<string, number> | null;
  usage: Record<string, number>;
  subscription: Row | null;
  invoices: Row[];
  plans: Row[];
  simulationEnabled: boolean;
};

/** Plan, usage against limits, invoices and renewal for the organization. */
export default function EnterpriseBillingPage() {
  const state = useWorkspaceData<Billing>("/enterprise-billing");
  const command = useWorkspaceCommand();
  const [planCode, setPlanCode] = useState("");
  const b = state.data;
  return (
    <ManagePage>
      <PageHeader
        title="Gói dịch vụ & hóa đơn"
        description="Hạn mức đang dùng, ngày hết hạn, hóa đơn và gia hạn. Thanh toán hiện là chuyển khoản được AgriTrace xác nhận; thanh toán trực tuyến (SePay) sẽ bổ sung sau."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {b && (
        <>
          <Section title="Gói hiện tại">
            <DetailList
              items={[
                ["Tình trạng", <StatusBadge key="s" value={b.status === "ACTIVE" || b.status === "PARTICIPANT" ? "ACTIVE" : b.status === "RESTRICTED" ? "LOCKED" : "PENDING_REVIEW"} label={label(subscriptionLabels, b.status)} />],
                ["Gói", b.subscription ? `${b.subscription.planName} (v${(b.subscription.planVersion as Row).version})` : b.paying ? "Chưa có gói" : "Tham gia chuỗi miễn phí"],
                ["Hiệu lực đến", shortDate(b.subscription?.endsAt)],
                ["Hết ân hạn", shortDate(b.subscription?.graceEndsAt)],
              ]}
            />
            {b.status === "GRACE" && <p className="notice">Gói đã hết hạn và đang trong thời gian ân hạn. Gia hạn để tránh bị chặn tạo mới sản phẩm, chuỗi, thành viên và tem QR.</p>}
            {b.status === "RESTRICTED" && <p className="notice error">Gói đã quá ân hạn: không tạo mới được sản phẩm, chuỗi, thành viên và tem QR. Giao nhận đang dở và trang QR công khai vẫn hoạt động.</p>}
          </Section>
          {b.limits && (
            <Section title="Hạn mức">
              <DataTable
                label="Hạn mức"
                rows={Object.keys(resourceLabels).map((k) => ({ k }))}
                rowKey={(r) => r.k}
                columns={[
                  { header: "Hạng mục", cell: (r) => resourceLabels[r.k] },
                  { header: "Đã dùng", cell: (r) => String(b.usage[r.k] ?? 0) },
                  { header: "Hạn mức", cell: (r) => String(b.limits?.[r.k] ?? "—") },
                  { header: "", cell: (r) => ((b.usage[r.k] ?? 0) >= (b.limits?.[r.k] ?? 0) ? <StatusBadge value="LOCKED" label="Đã đạt hạn mức" /> : null) },
                ]}
              />
            </Section>
          )}
          {b.subscription && b.paying && (
            <Section title="Gia hạn" help="Tạo hóa đơn gia hạn; khi thanh toán được xác nhận, kỳ mới nối tiếp ngày hết hạn hiện tại.">
              <form
                className="admin-inline-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if ((await command.run("/enterprise-billing/renewals", { planCode: planCode || String(b.subscription!.planCode) })) !== false) state.reload();
                }}
              >
                <label className="field">Gói gia hạn
                  <select className="input" value={planCode || String(b.subscription.planCode)} onChange={(e) => setPlanCode(e.target.value)}>
                    {b.plans.map((p) => <option key={String(p.code)} value={String(p.code)}>{String(p.name)} — {money(p.annual)}/kỳ</option>)}
                  </select>
                </label>
                <button className="button" disabled={command.pending}>Tạo hóa đơn gia hạn</button>
              </form>
            </Section>
          )}
          <Section title="Hóa đơn">
            <DataTable<Row>
              label="Hóa đơn"
              rows={b.invoices}
              rowKey={(r) => String(r.id)}
              empty={{ title: "Chưa có hóa đơn", description: "Hóa đơn phát sinh khi chấp nhận hợp đồng hoặc gia hạn." }}
              columns={[
                { header: "Số", cell: (r) => String(r.number) },
                { header: "Nội dung", cell: (r) => (r.lines as Row[]).map((l) => String(l.description)).join("; ") },
                { header: "Số tiền", cell: (r) => money(r.amount) },
                { header: "Hạn thanh toán", cell: (r) => shortDate(r.dueAt) },
                { header: "Trạng thái", cell: (r) => `${label(invoiceLabels, r.status)}${r.simulated ? " (mô phỏng)" : ""}` },
                {
                  header: "",
                  cell: (r) =>
                    r.status === "ISSUED" ? (
                      b.simulationEnabled ? (
                        <button type="button" className="button secondary small" disabled={command.pending} onClick={async () => {
                          if ((await command.run(`/enterprise-billing/invoices/${r.id}/payment-simulation`, { version: r.version })) !== false) state.reload();
                        }}>Thanh toán mô phỏng</button>
                      ) : (
                        <small>Chuyển khoản với nội dung {String(r.number)}; AgriTrace xác nhận khi nhận tiền.</small>
                      )
                    ) : null,
                },
              ]}
            />
          </Section>
        </>
      )}
    </ManagePage>
  );
}
