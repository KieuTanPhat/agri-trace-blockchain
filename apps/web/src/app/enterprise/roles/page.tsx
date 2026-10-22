"use client";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  groupPermissions,
  permissionLabels,
  useWorkspaceCommand,
  useWorkspaceData,
  type EnterpriseMember,
  type EnterpriseRole,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { useConfirm } from "@/lib/confirm";
import {
  CommandState,
  EmptyState,
  LoadState,
  PageHeader,
} from "@/components/manage";
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
  const command = useWorkspaceCommand();
  const confirm = useConfirm();
  async function remove(role: EnterpriseRole) {
    if (
      !(await confirm(
        `Xóa nhóm quyền "${role.name}"? Thao tác không hoàn tác được.`,
        "Xác nhận xóa nhóm quyền",
      ))
    )
      return;
    if (
      await command.run(
        `/enterprise-workspace/roles/${role.id}/delete`,
        { version: role.version },
        "POST",
        { confirmed: true },
      )
    )
      state.reload();
  }
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
      <CommandState command={command} />
      <div className="workspace-grid">
        {state.data?.items.map((r) => (
          <article className="workspace-tile role-tile" key={r.id}>
            <div className="role-tile-head">
              <h2>{r.name}</h2>
              {canManage && (
                <span className="row-actions">
                  <Link className="button secondary small" href={`/enterprise/roles/${r.id}`}>
                    Sửa
                  </Link>
                  {usage(r.id) === 0 && (
                    <Button
                      type="button"
                      className="button danger small"
                      disabled={command.pending}
                      onClick={() => void remove(r)}
                    >
                      Xóa
                    </Button>
                  )}
                </span>
              )}
            </div>
            {canManage && usage(r.id) > 0 && (
              <small className="muted">
                Đang gán cho {usage(r.id)} thành viên — quyền sửa sẽ áp dụng ngay cho những thành viên này.
              </small>
            )}
            {groupPermissions(r.permissions).map((group) => (
              <div className="role-permission-group" key={group.title}>
                <strong>{group.title}</strong>
                <ul>
                  {group.codes.map((p) => (
                    <li key={p}>{permissionLabels[p] ?? p}</li>
                  ))}
                </ul>
              </div>
            ))}
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
