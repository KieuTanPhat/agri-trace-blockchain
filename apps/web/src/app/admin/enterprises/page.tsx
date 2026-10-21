"use client";

import Link from "next/link";
import { useState } from "react";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import { hostingLabels } from "@/lib/enterprise-onboarding";
import { useWorkspaceData } from "@/lib/workspace";
import {
  DataTable,
  FilterBar,
  LoadState,
  PageHeader,
  ReloadButton,
  SearchField,
  StatusBadge,
} from "@/components/manage";

const filters = [
  { value: "", label: "Tất cả" },
  { value: "PENDING_REVIEW", label: "Chờ duyệt" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "REJECTED", label: "Từ chối" },
];
const stages: Record<string, string> = {
  PENDING_REVIEW: "Chờ xét duyệt",
  SELECT_SERVICE: "Chờ chọn gói",
  AWAITING_PAYMENT: "Chờ thanh toán",
  ACTIVE: "Đã kích hoạt",
  ACTIVE_LEGACY: "Đã kích hoạt trước đây",
};

export default function EnterprisesPage() {
  const state = useWorkspaceData<Enrollment[]>("/enterprise-enrollments");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const needle = query.trim().toLocaleLowerCase("vi");
  const rows = (state.data ?? [])
    .filter(
      (entry) =>
        (!status || entry.status === status) &&
        `${entry.organizationName} ${entry.businessId} ${entry.representativeEmail}`
          .toLocaleLowerCase("vi")
          .includes(needle),
    )
    .sort((a, b) =>
      a.status === "PENDING_REVIEW" && b.status !== "PENDING_REVIEW"
        ? -1
        : b.status === "PENDING_REVIEW" && a.status !== "PENDING_REVIEW"
          ? 1
          : b.createdAt.localeCompare(a.createdAt),
    );
  return (
    <div className="manage-console">
      <PageHeader
        title="Hồ sơ doanh nghiệp"
        description="Tìm, kiểm tra và xử lý từng hồ sơ. Doanh nghiệp chỉ được chọn dịch vụ sau khi được duyệt."
        back="/admin"
      />
      <LoadState {...state} />
      <section className="manage-section" aria-label="Danh sách hồ sơ">
        <FilterBar>
          <SearchField
            label="Tìm theo tên, mã số hoặc email doanh nghiệp"
            placeholder="Tìm tên, mã số hoặc email"
            value={query}
            onChange={setQuery}
          />
          <ReloadButton onClick={state.reload} />
        </FilterBar>
        <div
          className="manage-filter-tabs"
          role="group"
          aria-label="Lọc trạng thái hồ sơ"
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
        </div>
        <div className="manage-results-summary" role="status">
          {state.loading ? "Đang tải hồ sơ…" : `${rows.length} hồ sơ phù hợp`}
        </div>
        {!state.loading && !state.error && (
          <DataTable
            label="Hồ sơ doanh nghiệp"
            rows={rows}
            rowKey={(entry) => entry.id}
            empty={{
              title: "Không tìm thấy hồ sơ",
              description: "Thử từ khóa khác hoặc chọn lại trạng thái.",
            }}
            columns={[
              {
                header: "Doanh nghiệp",
                cell: (entry) => (
                  <>
                    <strong>{entry.organizationName}</strong>
                    <small>{entry.representativeEmail}</small>
                  </>
                ),
              },
              { header: "Mã số", cell: (entry) => entry.businessId },
              {
                header: "Xét duyệt",
                cell: (entry) => <StatusBadge value={entry.status} />,
              },
              {
                header: "Dịch vụ",
                cell: (entry) =>
                  stages[entry.onboardingStage] ?? "Chưa kích hoạt",
              },
              {
                header: "Mô hình peer",
                cell: (entry) =>
                  hostingLabels[entry.hostingMode] ?? entry.hostingMode,
              },
              {
                header: <span className="sr-only">Thao tác</span>,
                cell: (entry) => (
                  <Link
                    className="manage-row-link"
                    href={`/admin/enterprises/${entry.id}`}
                  >
                    {entry.status === "PENDING_REVIEW"
                      ? "Xem và duyệt"
                      : "Xem hồ sơ"}

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
