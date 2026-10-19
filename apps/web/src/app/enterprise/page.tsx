"use client";
import Link from "next/link";
import { useWorkspaceData, type Overview } from "@/lib/workspace";
import { LoadState, OverviewChart, PageHeader } from "@/components/manage";
export default function EnterprisePage() {
  const state = useWorkspaceData<Overview>("/enterprise-workspace");
  const visibleCounts = state.data ? (
    [
      { label: "Thành viên", key: "members", permission: "members.read" },
      { label: "Cơ sở", key: "sites", permission: "sites.read" },
      { label: "Sản phẩm riêng", key: "products", permission: "catalog.read" },
      { label: "Giao nhận", key: "transfers", permission: "distribution.read" },
    ] as const
  ).filter((entry) => state.data!.permissions.includes(entry.permission)).map((entry) => ({
    label: entry.label,
    value: state.data!.counts[entry.key] ?? 0,
  })) : [];
  return (
    <div className="manage-console">
      <PageHeader
        title={state.data?.organization.name ?? "Doanh nghiệp của bạn"}
        description="Quản lý người tham gia và dữ liệu trong hành trình truy xuất."
        actions={
          state.data?.member.enrollmentOwner && (
            <Link className="button secondary" href="/enterprise/connections">
              Theo dõi hồ sơ & kết nối
            </Link>
          )
        }
      />
      <LoadState {...state} />
      {state.data && (
        <>
          <div className="manage-metrics" aria-label="Số liệu doanh nghiệp">
            {visibleCounts.map(({ label, value }) => (
              <div className="manage-metric" key={label}>
                <span>{label}</span>
                <strong>{value.toLocaleString("vi-VN")}</strong>
                <small>Trong phạm vi doanh nghiệp</small>
              </div>
            ))}
          </div>
          {visibleCounts.length > 0 && <OverviewChart title="Hoạt động doanh nghiệp" description="Số lượng hiện tại theo từng danh mục bạn được xem" items={visibleCounts} />}
        </>
      )}
    </div>
  );
}
