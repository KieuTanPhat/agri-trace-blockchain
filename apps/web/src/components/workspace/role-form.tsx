"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import {
  permissionLabels,
  useWorkspaceCommand,
  useWorkspaceData,
  type EnterpriseRole,
  type EnterpriseRoleTemplate,
  type Items,
  type Overview,
} from "@/lib/workspace";
import { CommandState, PageHeader } from "@/components/manage";
/** Create or edit an enterprise role. Editing sends the role's version so a
 * concurrent change is rejected instead of overwritten. */
export function RoleForm({ role }: { role?: EnterpriseRole }) {
  const router = useRouter(),
    cmd = useWorkspaceCommand(),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    templates = useWorkspaceData<Items<EnterpriseRoleTemplate>>(
      "/enterprise-workspace/role-templates",
    ),
    [selected, setSelected] = useState<string[]>(
      role?.permissions ?? ["profile.read"],
    );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name"));
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
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title={role ? `Chỉnh sửa nhóm quyền: ${role.name}` : "Tạo nhóm quyền"}
        description={
          role
            ? "Thay đổi áp dụng cho mọi thành viên đang thuộc nhóm này."
            : "Chỉ chọn các thao tác cần thiết cho công việc của thành viên."
        }
        back="/enterprise/roles"
      />
      {role && (
        <p className="notice">
          Chỉ sửa được nhóm chưa gán cho thành viên nào. Nhóm đang dùng: tạo nhóm
          mới với quyền mong muốn rồi chuyển từng thành viên sang.
        </p>
      )}
      <form className="panel workspace-form" onSubmit={submit}>
        <CommandState command={cmd} />
        <fieldset
          disabled={cmd.pending || cmd.frozen}
          className="enterprise-fields"
        >
          <label>
            Mẫu theo công việc
            <select
              className="input"
              defaultValue=""
              onChange={(e) => {
                const template = templates.data?.items.find(
                  (t) => t.code === e.target.value,
                );
                if (template) setSelected(template.permissions);
              }}
            >
              <option value="">Tự chọn quyền</option>
              {templates.data?.items.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Tên nhóm quyền
            <input
              className="input"
              name="name"
              defaultValue={role?.name}
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <div className="permission-grid">
            {Object.entries(permissionLabels)
              .filter(([code]) => overview.data?.permissions.includes(code))
              .map(([code, label]) => (
                <label className="permission-choice" key={code}>
                  <input
                    type="checkbox"
                    checked={selected.includes(code)}
                    onChange={(e) =>
                      setSelected((s) =>
                        e.target.checked
                          ? [...s, code]
                          : s.filter((p) => p !== code),
                      )
                    }
                  />
                  <span>{label}</span>
                </label>
              ))}
          </div>
        </fieldset>
        <button className="button" disabled={cmd.pending} type="submit">
          {cmd.pending
            ? "Đang lưu…"
            : cmd.frozen
              ? "Thử lại yêu cầu cũ"
              : role
                ? "Lưu thay đổi"
                : "Tạo nhóm quyền"}
        </button>
      </form>
    </div>
  );
}
