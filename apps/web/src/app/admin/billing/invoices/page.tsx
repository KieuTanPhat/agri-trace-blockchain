"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge, Tabs } from "@/components/manage";
import { dateTime, invoiceLabels, label, money, shortDate, type Items, type Row } from "@/lib/platform-admin";

/** Invoices and payments. A bank transfer is confirmed against its reference;
 * simulated payments are shown separately and never count as revenue. */
export default function InvoicesPage() {
  const [status, setStatus] = useState("ISSUED");
  const state = useWorkspaceData<Items>(`/platform-billing/invoices${status ? `?status=${status}` : ""}`);
  const command = useWorkspaceCommand();
  const [references, setReferences] = useState<Record<string, string>>({});
  return (
    <ManagePage>
      <PageHeader
        title="Hóa đơn & thanh toán"
        description="Đối chiếu chuyển khoản và xác nhận thanh toán thủ công (cần người thứ hai duyệt khi bật phê duyệt hai bước). Cổng SePay sẽ ghi cùng sổ hóa đơn khi tích hợp."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: "ISSUED", label: "Chờ thanh toán" },
          { value: "OVERDUE", label: "Quá hạn" },
          { value: "PAID", label: "Đã thanh toán" },
          { value: "VOID", label: "Đã hủy" },
          { value: "", label: "Tất cả" },
        ]}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      <Section label="Hóa đơn">
        <DataTable<Row>
          label="Hóa đơn"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Không có hóa đơn", description: "Hóa đơn phát sinh khi doanh nghiệp chấp nhận hợp đồng hoặc gia hạn." }}
          columns={[
            { header: "Số", cell: (r) => <strong>{String(r.number)}</strong> },
            { header: "Doanh nghiệp", cell: (r) => <Link href={`/admin/directory/${r.organizationId}`}>{String(r.organizationName)}</Link> },
            { header: "Loại", cell: (r) => (r.kind === "INITIAL" ? "Khởi tạo" : r.kind === "RENEWAL" ? "Gia hạn" : String(r.kind)) },
            { header: "Số tiền", cell: (r) => money(r.amount) },
            { header: "Phát hành / hạn", cell: (r) => `${shortDate(r.issuedAt)} → ${shortDate(r.dueAt)}` },
            {
              header: "Trạng thái",
              cell: (r) => (
                <StatusBadge
                  value={r.status === "PAID" ? "ACTIVE" : r.status === "VOID" ? "CANCELLED" : r.overdue ? "FAILED" : "PENDING_REVIEW"}
                  label={`${label(invoiceLabels, r.status)}${r.overdue ? " · quá hạn" : ""}${r.simulated ? " · mô phỏng" : ""}`}
                />
              ),
            },
            { header: "Thanh toán", cell: (r) => (r.paidAt ? `${dateTime(r.paidAt)} · ${r.provider}${r.providerReference ? ` · ${r.providerReference}` : ""}` : "—") },
            {
              header: "Thao tác",
              cell: (r) =>
                r.status === "ISSUED" ? (
                  <div className="actions">
                    <ReasonAction
                      label="Xác nhận chuyển khoản"
                      disabled={command.pending}
                      extra={
                        <input
                          className="input"
                          aria-label="Mã giao dịch ngân hàng"
                          placeholder="Mã giao dịch / nội dung chuyển khoản"
                          value={references[String(r.id)] ?? ""}
                          onChange={(e) => setReferences({ ...references, [String(r.id)]: e.target.value })}
                          required
                          minLength={4}
                        />
                      }
                      onSubmit={async (reason) => {
                        const done = await command.run(`/platform-billing/invoices/${r.id}/confirm-payment`, { version: r.version, reference: (references[String(r.id)] ?? "").trim(), reason });
                        if (done !== false) state.reload();
                        return done;
                      }}
                    />
                    <ReasonAction
                      label="Hủy hóa đơn"
                      danger
                      disabled={command.pending}
                      onSubmit={async (reason) => {
                        const done = await command.run(`/platform-billing/invoices/${r.id}/void`, { version: r.version, reason });
                        if (done !== false) state.reload();
                        return done;
                      }}
                    />
                  </div>
                ) : null,
            },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
