"use client";

import Link from "next/link";
import { useState } from "react";
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

type Organization = { id: string; name: string; type: string; status: string };
const organizationLabels: Record<string, string> = {
  FARM: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
  AUDITOR: "Kiểm định",
};

export default function AdminOrganizationsPage({
  auditorsOnly = false,
}: {
  auditorsOnly?: boolean;
}) {
  const state = useWorkspaceData<Organization[]>("/organizations");
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const needle = query.trim().toLocaleLowerCase("vi");
  const rows = (state.data ?? []).filter(
    (organization) =>
      (!auditorsOnly || organization.type === "AUDITOR") &&
      (!type || organization.type === type) &&
      organization.name.toLocaleLowerCase("vi").includes(needle),
  );
  return (
    <div className="manage-console">
      <PageHeader
        title={auditorsOnly ? "Tổ chức kiểm định" : "Tổ chức tham gia"}
        description="Tra cứu các đơn vị trong hệ thống. Doanh nghiệp tham gia qua quy trình đăng ký và xét duyệt; admin chỉ tạo tổ chức kiểm định độc lập."
        back="/admin"
        action={{
          href: "/admin/organizations/new",
          label: "Tạo tổ chức kiểm định",
        }}
      />
      <LoadState {...state} />
      <section className="manage-section" aria-label="Danh sách tổ chức">
        <FilterBar>
          <SearchField
            label="Tìm tổ chức"
            placeholder="Tìm tên tổ chức"
            value={query}
            onChange={setQuery}
          />
          <select
            hidden={auditorsOnly}
            className="manage-filter-select"
            aria-label="Lọc loại tổ chức"
            value={type}
            onChange={(event) => setType(event.target.value)}
          >
            <option value="">Tất cả loại</option>
            {Object.entries(organizationLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <ReloadButton onClick={state.reload} />
        </FilterBar>
        <div className="manage-results-summary" role="status">
          {state.loading
            ? "Đang tải tổ chức…"
            : `${rows.length} tổ chức phù hợp`}
        </div>
        {!state.loading && !state.error && (
          <DataTable
            label="Tổ chức"
            rows={rows}
            rowKey={(organization) => organization.id}
            empty={{
              title: "Không tìm thấy tổ chức",
              description: "Thử tên hoặc bộ lọc khác.",
            }}
            columns={[
              {
                header: "Tổ chức",
                cell: (organization) => <strong>{organization.name}</strong>,
              },
              {
                header: "Lĩnh vực",
                cell: (organization) =>
                  organizationLabels[organization.type] ?? organization.type,
              },
              {
                header: "Trạng thái",
                cell: (organization) => (
                  <StatusBadge value={organization.status} />
                ),
              },
              {
                header: "Quy trình",
                cell: (organization) =>
                  organization.type === "AUDITOR"
                    ? "Nền tảng quản lý"
                    : "Doanh nghiệp tự đăng ký",
              },
            ]}
          />
        )}
      </section>
      <p className="manage-help-note">
        Cần xét duyệt doanh nghiệp mới?{" "}
        <Link href="/admin/enterprises">Mở hồ sơ đăng ký</Link>.
      </p>
    </div>
  );
}
