"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import { DataTable, LoadState, ManagePage, PageHeader, ReloadButton, Section, StatusBadge, Tabs } from "@/components/manage";
import { dateTime, label, priorityLabels, ticketCategoryLabels, ticketStatusLabels, type Items, type Row } from "@/lib/platform-admin";

/** Support requests from enterprises with their response deadline. */
export default function SupportTicketsPage() {
  const [status, setStatus] = useState("");
  const state = useWorkspaceData<Items>(`/platform-admin/tickets${status ? `?status=${status}` : ""}`);
  return (
    <ManagePage>
      <PageHeader
        title="Yêu cầu hỗ trợ"
        description="Doanh nghiệp gửi yêu cầu từ khu làm việc. Thời hạn phản hồi theo cấu hình và mức ưu tiên."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Tabs
        value={status}
        onChange={setStatus}
        tabs={[{ value: "", label: "Tất cả" }, ...Object.entries(ticketStatusLabels).map(([value, text]) => ({ value, label: text }))]}
      />
      <LoadState loading={state.loading} error={state.error} />
      <Section label="Yêu cầu">
        <DataTable<Row>
          label="Yêu cầu hỗ trợ"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Không có yêu cầu", description: "Chưa có yêu cầu phù hợp." }}
          columns={[
            { header: "Mã", cell: (r) => <Link href={`/admin/support/${r.id}`}>{String(r.code)}</Link> },
            { header: "Chủ đề", cell: (r) => String(r.subject) },
            { header: "Doanh nghiệp", cell: (r) => String(r.organizationName) },
            { header: "Loại", cell: (r) => label(ticketCategoryLabels, r.category) },
            { header: "Ưu tiên", cell: (r) => label(priorityLabels, r.priority) },
            { header: "Phụ trách", cell: (r) => String(r.assigneeName ?? "Chưa giao") },
            { header: "Hạn phản hồi", cell: (r) => dateTime(r.dueAt) },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={r.overdue ? "FAILED" : r.status === "CLOSED" ? "INACTIVE" : "PENDING_REVIEW"} label={`${label(ticketStatusLabels, r.status)}${r.overdue ? " · quá hạn" : ""}`} /> },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
