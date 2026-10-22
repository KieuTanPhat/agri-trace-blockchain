"use client";
import { Button } from "@/components/ui/button";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  groupPermissions,
  permissionLabels,
  useWorkspaceCommand,
  useWorkspaceData,
  type EnterpriseRole,
  type EnterpriseRoleTemplate,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { CommandState, PageHeader } from "@/components/manage";
import { RolePermissionEditor } from "./role-permission-editor";

/** Keep the same command and optimistic version while changing only the editor UI. */
export function RoleForm({ role }: { role?: EnterpriseRole }) {
  const router = useRouter();
  const cmd = useWorkspaceCommand();
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const templates = useWorkspaceData<Items<EnterpriseRoleTemplate>>(
    "/enterprise-workspace/role-templates",
  );
  const [name, setName] = useState(role?.name ?? "");
  const [selected, setSelected] = useState<string[]>(
    role?.permissions ?? ["profile.read"],
  );
  const groups = groupPermissions(
    Object.keys(permissionLabels).filter((code) =>
      overview.data?.permissions.includes(code),
    ),
  );
  const visibleSelectedCount = groups.reduce(
    (count, group) =>
      count + group.codes.filter((code) => selected.includes(code)).length,
    0,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      await cmd.run(
        role
          ? `/enterprise-workspace/roles/${role.id}`
          : "/enterprise-workspace/roles",
        role
          ? { name, permissions: selected, version: role.version }
          : { name, permissions: selected },
      )
    )
      router.push("/enterprise/roles");
  }

  return (
    <div className="manage-console role-editor-page">
      <PageHeader
        backLabel="Quay lại danh sách"
        title={role ? "Chỉnh sửa nhóm quyền" : "Tạo nhóm quyền"}
        back="/enterprise/roles"
      />
      <form className="workspace-form role-editor-form" onSubmit={submit}>
        <CommandState command={cmd} />
        <fieldset
          disabled={cmd.pending || cmd.frozen}
          className="enterprise-fields role-editor-fields"
        >
          <RolePermissionEditor
            groups={groups.map((group) => ({
              title: group.title,
              permissions: group.codes.map((code) => ({
                code,
                label: permissionLabels[code],
              })),
            }))}
            templates={templates.data?.items ?? []}
            selected={selected}
            name={name}
            editing={Boolean(role)}
            templatesLoading={templates.loading && !templates.data}
            templatesError={templates.error}
            onNameChange={setName}
            onSelectedChange={setSelected}
          />
        </fieldset>
        <div className="role-editor-actions">
          <div className="role-editor-summary">
            <span>{visibleSelectedCount} quyền đã chọn</span>
            {role && (
              <span>Áp dụng cho thành viên trong nhóm sau khi lưu.</span>
            )}
          </div>
          <Button
            className="button secondary"
            type="button"
            disabled={cmd.pending || cmd.frozen}
            onClick={() => router.push("/enterprise/roles")}
          >
            Hủy
          </Button>
          <Button className="button" disabled={cmd.pending} type="submit">
            {cmd.pending
              ? "Đang lưu…"
              : cmd.frozen
                ? "Thử lại yêu cầu cũ"
                : role
                  ? "Lưu thay đổi"
                  : "Tạo nhóm quyền"}
          </Button>
        </div>
      </form>
    </div>
  );
}
