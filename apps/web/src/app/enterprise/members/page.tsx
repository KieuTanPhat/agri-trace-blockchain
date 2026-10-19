"use client";
import Link from "next/link";
import {
  useWorkspaceData,
  type EnterpriseMember,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { LoadState, PageHeader, StatusBadge } from "@/components/manage";
import { EntityThumb } from "@/components/workspace/entity-thumb";
export default function MembersPage() {
  const state = useWorkspaceData<Items<EnterpriseMember>>(
      "/enterprise-workspace/members",
    ),
    overview = useWorkspaceData<Overview>("/enterprise-workspace");
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Thành viên doanh nghiệp"
        description="Cấp 1 quản trị doanh nghiệp. Cấp 2 quản lý theo ủy quyền. Cấp 3 thực hiện nghiệp vụ được giao."
        action={
          overview.data?.permissions.includes("members.manage")
            ? { href: "/enterprise/members/new", label: "Thêm thành viên" }
            : undefined
        }
      />
      <LoadState {...state} />
      <div className="workspace-actions">
        {overview.data?.permissions.includes("members.manage") && (
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
        <table className="manage-table">
          <thead>
            <tr>
              <th>Ảnh</th>
              <th>Thành viên</th>
              <th>Cấp tài khoản</th>
              <th>Nhóm quyền</th>
              <th>Trạng thái</th>
              <th>Thao tác</th>
            </tr>
          </thead>
          <tbody>
            {state.data?.items.map((m) => (
              <tr key={m.id}>
                <td data-label="Ảnh">
                  <EntityThumb entityType="MEMBER" entityId={m.id} kinds={["MEMBER_AVATAR"]} name={m.fullName} />
                </td>
                <td data-label="Thành viên">
                  {m.fullName}
                  <small>{m.jobTitle ? `${m.jobTitle} · ` : ""}{m.email}</small>
                </td>
                <td data-label="Cấp tài khoản">
                  <span className="workspace-badge">
                    Cấp {m.enterpriseTier ?? 1}
                  </span>
                </td>
                <td data-label="Nhóm quyền">
                  {m.enterpriseTier === 1 || m.enterpriseTier === null
                    ? "Quản trị doanh nghiệp"
                    : m.enterpriseRoles.map((r) => r.role.name).join(", ") ||
                      "Chưa gán nhóm"}
                </td>
                <td data-label="Trạng thái">
                  <StatusBadge value={m.accountStatus} />
                </td>
                <td data-label="Thao tác">
                  {overview.data?.permissions.includes("members.manage") &&
                    m.enterpriseTier !== 1 &&
                    m.enterpriseTier !== null && (
                      <Link
                        className="text-link"
                        href={`/enterprise/members/${m.id}`}
                      >
                        Quyền & trạng thái
                      </Link>
                    )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
