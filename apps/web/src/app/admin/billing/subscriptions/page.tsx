"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge, Tabs } from "@/components/manage";
import { label, shortDate, subscriptionLabels, type Items, type Row } from "@/lib/platform-admin";

/** Subscriptions with their effective state. Grace and restriction are derived
 * from the end date and the configured grace period. */
export default function SubscriptionsPage() {
  const [status, setStatus] = useState("");
  const state = useWorkspaceData<Items>(`/platform-billing/subscriptions${status ? `?status=${status}` : ""}`);
  const command = useWorkspaceCommand();
  return (
    <ManagePage>
      <PageHeader
        title="Đăng ký & gia hạn"
        description="Gói của từng doanh nghiệp, ngày hết hạn và ân hạn. Hết ân hạn thì chặn tạo mới sản phẩm, chuỗi, thành viên, tem QR; giao nhận đang dở và trang QR công khai vẫn hoạt động."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[
          { value: "", label: "Tất cả" },
          { value: "EXPIRING", label: "Sắp hết hạn (30 ngày)" },
          { value: "ACTIVE", label: "Hiệu lực" },
          { value: "GRACE", label: "Ân hạn" },
          { value: "RESTRICTED", label: "Hạn chế" },
          { value: "PENDING_PAYMENT", label: "Chờ thanh toán" },
        ]}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      <Section label="Danh sách gói">
        <DataTable<Row>
          label="Đăng ký gói dịch vụ"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Không có gói phù hợp", description: "Thử bộ lọc khác." }}
          columns={[
            { header: "Doanh nghiệp", cell: (r) => <Link href={`/admin/directory/${r.organizationId}`}>{String(r.organizationName)}</Link> },
            { header: "Gói", cell: (r) => `${r.planName} (v${(r.planVersion as Row).version})` },
            { header: "Bắt đầu", cell: (r) => shortDate(r.startsAt) },
            { header: "Hết hạn", cell: (r) => shortDate(r.endsAt) },
            { header: "Còn lại", cell: (r) => (r.daysRemaining === null ? "—" : `${r.daysRemaining} ngày`) },
            { header: "Hết ân hạn", cell: (r) => shortDate(r.graceEndsAt) },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={r.effectiveStatus === "ACTIVE" ? "ACTIVE" : r.effectiveStatus === "RESTRICTED" ? "LOCKED" : "PENDING_REVIEW"} label={label(subscriptionLabels, r.effectiveStatus)} /> },
            {
              header: "Thao tác",
              cell: (r) =>
                r.status === "ACTIVE" ? (
                  <ReasonAction
                    label="Phát hành hóa đơn gia hạn"
                    disabled={command.pending}
                    onSubmit={async (reason) => {
                      const done = await command.run(`/platform-billing/organizations/${r.organizationId}/renewal-invoices`, { planCode: r.planCode, reason });
                      if (done !== false) state.reload();
                      return done;
                    }}
                  />
                ) : null,
            },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
