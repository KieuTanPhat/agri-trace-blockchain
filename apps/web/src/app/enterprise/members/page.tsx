"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useState } from "react";
import {
  useWorkspaceData,
  type EnterpriseMember,
  type Items,
  type Overview,
} from "@/lib/workspace";
import {
  LoadState,
  PageHeader,
  StatusBadge,
} from "@/components/manage";

export default function MembersPage() {
  const state = useWorkspaceData<Items<EnterpriseMember>>(
      "/enterprise-workspace/members",
    ),
    overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const [showRemoved, setShowRemoved] = useState(false);
  const canManage = !!overview.data?.permissions.includes("members.manage");
  const rows = (state.data?.items ?? []).filter((m) =>
    showRemoved ? m.accountStatus === "INACTIVE" : m.accountStatus !== "INACTIVE",
  );
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Thành viên doanh nghiệp"
        description="Cấp 1 quản trị doanh nghiệp. Cấp 2 quản lý theo ủy quyền. Cấp 3 thực hiện nghiệp vụ được giao."
        action={
          canManage
            ? { href: "/enterprise/members/new", label: "Thêm thành viên" }
            : undefined
        }
      />
      <LoadState {...state} />
      <div className="workspace-actions">
        <div className="support-filter" role="tablist" aria-label="Lọc thành viên">
          <Button
            type="button"
            role="tab"
            aria-selected={!showRemoved}
            className={`button small ${showRemoved ? "secondary" : ""}`}
            onClick={() => setShowRemoved(false)}
          >
            Đang sử dụng
          </Button>
          <Button
            type="button"
            role="tab"
            aria-selected={showRemoved}
            className={`button small ${showRemoved ? "" : "secondary"}`}
            onClick={() => setShowRemoved(true)}
          >
            Đã xóa
          </Button>
        </div>
        {canManage && (
          <Link
            className="button secondary"
            href="/enterprise/members/invitations"
          >
            Lời mời đang gửi
          </Link>
        )}
        {overview.data?.member.primary && (
          <Link className="button secondary" href="/enterprise/ownership">
            Chuyển quyền chủ quản
          </Link>
        )}
      </div>
      <div className="manage-section manage-table-scroll">
        <Table className="manage-table">
          <TableHeader>
            <TableRow>
              <TableHead>Mã nhân viên</TableHead>
              <TableHead>Thành viên</TableHead>
              <TableHead>Số điện thoại</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Cấp tài khoản</TableHead>
              <TableHead>Nhóm quyền</TableHead>
              <TableHead>Trạng thái</TableHead>
              <TableHead aria-label="Xem chi tiết" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={m.id}>
                <TableCell data-label="Mã nhân viên">
                  <strong>{m.memberCode ?? "—"}</strong>
                </TableCell>
                <TableCell data-label="Thành viên">
                  {m.fullName}
                  {m.jobTitle && <small>{m.jobTitle}</small>}
                </TableCell>
                <TableCell data-label="Số điện thoại">{m.phone ?? "—"}</TableCell>
                <TableCell data-label="Email">{m.email}</TableCell>
                <TableCell data-label="Cấp tài khoản">
                  <span className="workspace-badge">
                    Cấp {m.enterpriseTier ?? 1}
                  </span>
                </TableCell>
                <TableCell data-label="Nhóm quyền">
                  {m.enterpriseTier === 1 || m.enterpriseTier === null
                    ? "Quản trị doanh nghiệp"
                    : m.enterpriseRoles.map((r) => r.role.name).join(", ") ||
                      "Chưa gán nhóm"}
                </TableCell>
                <TableCell data-label="Trạng thái">
                  <StatusBadge
                    value={m.accountStatus}
                    label={m.accountStatus === "INACTIVE" ? "Đã xóa" : undefined}
                  />
                </TableCell>
                <TableCell>
                  <Link
                    className="button secondary small"
                    href={`/enterprise/members/${m.id}`}
                  >
                    Xem chi tiết
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
