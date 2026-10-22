"use client";
import { NativeSelect } from "@/components/ui/native-select";

import Link from "next/link";
import { useState } from "react";
import type { components } from "@/lib/generated/api";
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

type Assignment = components["schemas"]["AssignmentListDto"];
type Account = components["schemas"]["UserListDto"];

export default function AdminAssignmentsPage() {
  const assignments = useWorkspaceData<Assignment[]>("/compliance/assignments");
  const users = useWorkspaceData<Account[]>("/users");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const needle = query.trim().toLocaleLowerCase("vi");
  const names = new Map(
    (users.data ?? []).map((user) => [user.id, user.fullName]),
  );
  const rows = (assignments.data ?? []).filter(
    (assignment) =>
      (status === "" ||
        (status === "ACTIVE"
          ? !assignment.revokedAt
          : !!assignment.revokedAt)) &&
      `${assignment.farm.name} ${names.get(assignment.reviewerUserId) ?? ""}`
        .toLocaleLowerCase("vi")
        .includes(needle),
  );
  return (
    <div className="manage-console">
      <PageHeader
        title="Phân công kiểm định"
        description="Gán người kiểm định độc lập theo nông trại; mọi lần cấp và thu hồi đều có lý do."
        back="/admin"
        action={{
          href: "/admin/compliance-assignments/new",
          label: "Tạo phân công",
        }}
      />
      <LoadState {...assignments} />
      <LoadState {...users} />
      <section className="manage-section" aria-label="Danh sách phân công">
        <FilterBar>
          <SearchField
            label="Tìm phân công kiểm định"
            placeholder="Tìm nông trại hoặc người kiểm định"
            value={query}
            onChange={setQuery}
          />
          <NativeSelect
            className="manage-filter-select"
            aria-label="Lọc trạng thái phân công"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="ACTIVE">Đang hoạt động</option>
            <option value="REVOKED">Đã thu hồi</option>
            <option value="">Tất cả</option>
          </NativeSelect>
          <ReloadButton
            onClick={() => {
              assignments.reload();
              users.reload();
            }}
          />
        </FilterBar>
        <div className="manage-results-summary" role="status">
          {assignments.loading || users.loading
            ? "Đang tải phân công…"
            : `${rows.length} phân công phù hợp`}
        </div>
        {!assignments.loading &&
          !users.loading &&
          !assignments.error &&
          !users.error && (
            <DataTable
              label="Phân công kiểm định"
              rows={rows}
              rowKey={(assignment) => assignment.id}
              empty={{
                title: "Không có phân công phù hợp",
                description: "Thử bộ lọc khác hoặc tạo phân công mới.",
              }}
              columns={[
                {
                  header: "Nông trại",
                  cell: (assignment) => <strong>{assignment.farm.name}</strong>,
                },
                {
                  header: "Người kiểm định",
                  cell: (assignment) =>
                    names.get(assignment.reviewerUserId) ??
                    "Tài khoản không còn hoạt động",
                },
                {
                  header: "Trạng thái",
                  cell: (assignment) => (
                    <StatusBadge
                      value={assignment.revokedAt ? "REVOKED" : "ACTIVE"}
                    />
                  ),
                },
                {
                  header: <span className="sr-only">Thao tác</span>,
                  cell: (assignment) => (
                    <Link
                      className="manage-row-link"
                      href={`/admin/compliance-assignments/${assignment.id}`}
                    >
                      Xem phân công
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
