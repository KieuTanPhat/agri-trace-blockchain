"use client";
import { NativeSelect } from "@/components/ui/native-select";

import Link from "next/link";
import { useState } from "react";
import type { components } from "@/lib/generated/api";
import { useWorkspaceData } from "@/lib/workspace";
import { platformAdminLabels } from "@/lib/permissions";
import {
  DataTable,
  FilterBar,
  LoadState,
  PageHeader,
  ReloadButton,
  SearchField,
  StatusBadge,
} from "@/components/manage";

type Account = components["schemas"]["UserListDto"];
const managedRoles: Record<string, string> = {
  ...platformAdminLabels,
  COMPLIANCE_REVIEWER: "Người kiểm định",
};

export default function AdminUsersPage({
  reviewersOnly = false,
}: {
  reviewersOnly?: boolean;
}) {
  const state = useWorkspaceData<Account[]>("/users");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const needle = query.trim().toLocaleLowerCase("vi");
  const rows = (state.data ?? []).filter(
    (account) =>
      (!reviewersOnly || account.role.code === "COMPLIANCE_REVIEWER") &&
      account.role.code in managedRoles &&
      (!role || account.role.code === role) &&
      `${account.fullName} ${account.email} ${account.organization?.name ?? ""}`
        .toLocaleLowerCase("vi")
        .includes(needle),
  );
  return (
    <div className="manage-console">
      <PageHeader
        title={
          reviewersOnly ? "Tài khoản kiểm định viên" : "Tài khoản nền tảng"
        }
        description="Quản lý quản trị viên và người kiểm định. Nhân viên cấp 1–2–3 được quản lý trong doanh nghiệp."
        back="/admin"
        action={{ href: "/admin/users/new", label: "Tạo tài khoản" }}
      />
      <LoadState {...state} />
      <section
        className="manage-section"
        aria-label="Danh sách tài khoản nền tảng"
      >
        <FilterBar>
          <SearchField
            label="Tìm tài khoản nền tảng"
            placeholder="Tìm tên, email hoặc tổ chức"
            value={query}
            onChange={setQuery}
          />
          <NativeSelect
            hidden={reviewersOnly}
            className="manage-filter-select"
            aria-label="Lọc nhóm tài khoản"
            value={role}
            onChange={(event) => setRole(event.target.value)}
          >
            <option value="">Tất cả nhóm</option>
            {Object.entries(platformAdminLabels).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
            <option value="COMPLIANCE_REVIEWER">Người kiểm định</option>
          </NativeSelect>
          <ReloadButton onClick={state.reload} />
        </FilterBar>
        <div className="manage-results-summary" role="status">
          {state.loading
            ? "Đang tải tài khoản…"
            : `${rows.length} tài khoản phù hợp`}
        </div>
        {!state.loading && !state.error && (
          <DataTable
            label="Tài khoản nền tảng"
            rows={rows}
            rowKey={(account) => account.id}
            empty={{
              title: "Không tìm thấy tài khoản",
              description: "Thử tên hoặc bộ lọc khác.",
            }}
            columns={[
              {
                header: "Tài khoản",
                cell: (account) => (
                  <>
                    <strong>{account.fullName}</strong>
                    <small>{account.email}</small>
                  </>
                ),
              },
              {
                header: "Vai trò",
                cell: (account) => managedRoles[account.role.code],
              },
              {
                header: "Tổ chức",
                cell: (account) => account.organization?.name ?? "AgriTrace",
              },
              {
                header: "Trạng thái",
                cell: (account) => (
                  <StatusBadge value={account.accountStatus} />
                ),
              },
              {
                header: <span className="sr-only">Thao tác</span>,
                cell: (account) => (
                  <Link
                    className="manage-row-link"
                    href={`/admin/users/${account.id}`}
                  >
                    Quản lý
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
