"use client";

import { useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import type { components } from "@/lib/generated/api";
import type { Catalog } from "@/lib/catalog";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

type Account = components["schemas"]["UserListDto"];

export default function NewAssignmentPage() {
  const router = useRouter();
  const users = useWorkspaceData<Account[]>("/users");
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const reviewerOptions = (users.data ?? [])
    .filter(
      (user) =>
        user.accountStatus === "ACTIVE" &&
        user.role.code === "COMPLIANCE_REVIEWER" &&
        user.organization?.type === "AUDITOR",
    )
    .map((user) => ({
      value: user.id,
      label: `${user.fullName} — ${user.email}`,
    }));
  const farmOptions = (catalog.data?.farms ?? [])
    .filter(
      (farm) =>
        farm.status === "ACTIVE" && farm.organization.status === "ACTIVE",
    )
    .map((farm) => ({
      value: farm.id,
      label: `${farm.name} — ${farm.organization.name}`,
    }));
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Tạo phân công kiểm định"
        description="Chọn người kiểm định đang hoạt động, nông trại và ghi rõ lý do phân công."
        back="/admin/compliance-assignments"
      />
      <LoadState {...users} />
      <LoadState {...catalog} />
      {!users.loading &&
        !catalog.loading &&
        (!reviewerOptions.length || !farmOptions.length) && (
          <p className="notice" role="status">
            {!reviewerOptions.length
              ? "Cần có tài khoản người kiểm định đang hoạt động. "
              : ""}
            {!farmOptions.length
              ? "Chưa có nông trại đang hoạt động để phân công."
              : ""}
          </p>
        )}
      <div className="manage-form-shell">
        <DataForm
          title="Cấp phân công"
          path="/compliance/assignments"
          fields={[
            {
              name: "reviewerUserId",
              label: "Người kiểm định",
              required: true,
              options: reviewerOptions,
            },
            {
              name: "farmId",
              label: "Nông trại",
              required: true,
              options: farmOptions,
            },
            {
              name: "reason",
              label: "Lý do phân công",
              required: true,
              maxLength: 1000,
            },
          ]}
          onSaved={() => router.push("/admin/compliance-assignments")}
        />
      </div>
    </div>
  );
}
