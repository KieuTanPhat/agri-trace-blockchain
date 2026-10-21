"use client";

import Link from "next/link";
import { useState } from "react";
import {
  approvalOperationLabels,
  approvalStatusLabels,
  formatDateTime,
  type Approval,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import {
  DataTable,
  LoadState,
  PageHeader,
  ReloadButton,
} from "@/components/manage";

const filters = [
  { value: "PENDING", label: "Chờ phê duyệt" },
  { value: "", label: "Tất cả" },
  { value: "APPROVED", label: "Đã phê duyệt" },
  { value: "REJECTED", label: "Đã từ chối" },
  { value: "EXPIRED", label: "Hết hạn" },
];

export default function ApprovalsPage() {
  const [status, setStatus] = useState("PENDING");
  const state = useWorkspaceData<Approval[]>(
    `/platform-approvals${status ? `?status=${status}` : ""}`,
  );
  const rows = state.data ?? [];
  return (
    <div className="manage-console">
      <PageHeader
        title="Phê duyệt hai bước"
        description="Cấp năng lực, quyền tạo chuỗi, tạo quản trị viên và chấp nhận kết nối peer cần một quản trị viên đề xuất và một quản trị viên khác phê duyệt."
        back="/admin"
        action={{ href: "/admin/approvals/new", label: "Tạo đề xuất" }}
      />
      <LoadState {...state} />
      <section className="manage-section" aria-label="Danh sách đề xuất">
        <div
          className="manage-filter-tabs"
          role="group"
          aria-label="Lọc trạng thái đề xuất"
        >
          {filters.map((filter) => (
            <button
              type="button"
              key={filter.value}
              aria-pressed={status === filter.value}
              onClick={() => setStatus(filter.value)}
            >
              {filter.label}
            </button>
          ))}
          <ReloadButton onClick={state.reload} />
        </div>
        <div className="manage-results-summary" role="status">
          {state.loading ? "Đang tải đề xuất…" : `${rows.length} đề xuất`}
        </div>
        {!state.loading && !state.error && (
          <DataTable
            label="Đề xuất phê duyệt"
            rows={rows}
            rowKey={(row) => row.id}
            empty={{
              title: "Không có đề xuất",
              description:
                "Đề xuất mới xuất hiện tại đây để quản trị viên khác phê duyệt.",
            }}
            columns={[
              {
                header: "Thao tác",
                cell: (row) => (
                  <>
                    <strong>
                      {approvalOperationLabels[row.operation] ?? row.operation}
                    </strong>
                    <small>{row.proposerReason}</small>
                  </>
                ),
              },
              {
                header: "Người đề xuất",
                cell: (row) => (
                  <>
                    {row.proposer.fullName}
                    <small>{row.proposer.email}</small>
                  </>
                ),
              },
              { header: "Hạn", cell: (row) => formatDateTime(row.expiresAt) },
              {
                header: "Trạng thái",
                cell: (row) =>
                  approvalStatusLabels[row.effectiveStatus] ??
                  row.effectiveStatus,
              },
              {
                header: <span className="sr-only">Xem</span>,
                cell: (row) => (
                  <Link
                    className="manage-row-link"
                    href={`/admin/approvals/${row.id}`}
                  >
                    Xem
                  </Link>
                ),
              },
            ]}
          />
        )}
      </section>
    </div>
  );
}
