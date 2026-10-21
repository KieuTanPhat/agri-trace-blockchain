"use client";

import Link from "next/link";
import {
  useWorkspaceData,
  labels,
  textValue,
  type Items,
  type ProfileAmendmentListItem,
} from "@/lib/workspace";
import {
  DataTable,
  LoadState,
  PageHeader,
  ReloadButton,
  StatusBadge,
} from "@/components/manage";

const status: Record<string, string> = {
  PENDING: "PENDING_REVIEW",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
};

export default function ProfileAmendmentsPage() {
  const state = useWorkspaceData<Items<ProfileAmendmentListItem>>(
    "/enterprise-profile-amendments",
  );
  const rows = state.data?.items ?? [];
  return (
    <div className="manage-console">
      <PageHeader
        title="Điều chỉnh hồ sơ doanh nghiệp"
        description="Thay đổi pháp lý và hoạt động chỉ có hiệu lực sau khi được duyệt. Lịch sử lô và chứng cứ đã ghi không đổi."
        back="/admin/enterprises"
      />
      <LoadState {...state} />
      <section
        className="manage-section"
        aria-label="Danh sách hồ sơ điều chỉnh"
      >
        <div className="manage-filter-bar">
          <div className="manage-results-summary" role="status">
            {state.loading
              ? "Đang tải hồ sơ…"
              : `${rows.filter((r) => r.status === "PENDING").length} hồ sơ chờ duyệt / ${rows.length} hồ sơ`}
          </div>
          <ReloadButton onClick={state.reload} />
        </div>
        {!state.loading && !state.error && (
          <DataTable
            label="Hồ sơ điều chỉnh"
            rows={rows}
            rowKey={(r) => r.id}
            empty={{
              title: "Chưa có hồ sơ điều chỉnh",
              description:
                "Doanh nghiệp gửi điều chỉnh từ trang hồ sơ hoặc khi bổ sung hồ sơ bị từ chối.",
            }}
            columns={[
              {
                header: "Tổ chức",
                cell: (r) => <strong>{textValue(r.organizationName)}</strong>,
              },
              {
                header: "Đề nghị",
                cell: (r) => (
                  <>
                    {r.target.name}
                    <small>
                      {r.target.activities
                        .map((a) => labels[a] ?? a)
                        .join(", ")}
                    </small>
                  </>
                ),
              },
              {
                header: "Trạng thái",
                cell: (r) => (
                  <StatusBadge
                    value={status[r.status] ?? r.status}
                  />
                ),
              },
              {
                header: "Ngày gửi",
                cell: (r) =>
                  new Date(r.createdAt).toLocaleString("vi-VN"),
              },
              {
                header: <span className="sr-only">Thao tác</span>,
                cell: (r) => (
                  <Link
                    className="manage-row-link"
                    href={`/admin/enterprises/amendments/${r.id}`}
                  >
                    {r.status === "PENDING" ? "Xem và duyệt" : "Xem hồ sơ"}

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
