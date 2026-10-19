"use client";
import { useParams } from "next/navigation";
import { useWorkspaceData, type EnterpriseRole, type Items } from "@/lib/workspace";
import { EmptyState, LoadState, PageHeader } from "@/components/manage";
import { RoleForm } from "@/components/workspace/role-form";
export default function EditRolePage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<Items<EnterpriseRole>>("/enterprise-workspace/roles");
  const role = state.data?.items.find((r) => r.id === id);
  if (role) return <RoleForm key={`${role.id}:${role.version}`} role={role} />;
  return (
    <div className="manage-console">
      <PageHeader back="/enterprise/roles" backLabel="Quay lại danh sách" title="Chỉnh sửa nhóm quyền" />
      <LoadState {...state} />
      {state.data && <EmptyState title="Không tìm thấy nhóm quyền" description="Nhóm có thể đã bị xóa hoặc không thuộc doanh nghiệp của bạn." />}
    </div>
  );
}
