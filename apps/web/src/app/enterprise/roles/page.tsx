"use client";
import Link from "next/link";
import {
  permissionLabels,
  useWorkspaceData,
  type EnterpriseMember,
  type EnterpriseRole,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { EmptyState, LoadState, PageHeader } from "@/components/manage";
export default function RolesPage() {
  const state = useWorkspaceData<Items<EnterpriseRole>>(
    "/enterprise-workspace/roles",
  );
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const canManage = !!overview.data?.permissions.includes("roles.manage");
  const members = useWorkspaceData<Items<EnterpriseMember>>(
    canManage ? "/enterprise-workspace/members" : null,
  );
  // The API refuses to edit a role that is assigned; say so before opening it.
  const usage = (roleId: string) =>
    members.data?.items.filter((m) => m.enterpriseRoles.some((r) => r.roleId === roleId)).length ?? 0;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Nhóm quyền"
        description="Mỗi nhóm xác định các thao tác được phép. Phạm vi chuỗi và cơ sở được chọn khi gán cho thành viên."
        action={
          canManage
            ? { href: "/enterprise/roles/new", label: "Tạo nhóm quyền" }
            : undefined
        }
      />
      <LoadState {...state} />
      <div className="workspace-grid">
        {state.data?.items.map((r) => (
          <article className="workspace-tile role-tile" key={r.id}>
            <div className="role-tile-head">
              <h2>{r.name}</h2>
              {canManage && (
                <Link className="button secondary small" href={`/enterprise/roles/${r.id}`}>
                  Chỉnh sửa
                </Link>
              )}
            </div>
            {canManage && usage(r.id) > 0 && (
              <small className="muted">
                Đang gán cho {usage(r.id)} thành viên — muốn đổi quyền, tạo nhóm mới rồi chuyển từng thành viên sang.
              </small>
            )}
            <ul>
              {r.permissions.map((p) => (
                <li key={p}>{permissionLabels[p] ?? p}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      {state.data && !state.data.items.length && (
        <EmptyState
          title="Chưa có nhóm quyền"
          description="Tạo nhóm phù hợp với công việc trước khi thêm thành viên."
        />
      )}
    </div>
  );
}
