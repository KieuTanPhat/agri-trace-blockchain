"use client";

import { useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import { PageHeader } from "@/components/manage";

export default function NewAuditorOrganizationPage() {
  const router = useRouter();
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Tạo tổ chức kiểm định"
        description="Tổ chức này dùng để quản lý người kiểm định độc lập và phân công theo nông trại."
        back="/admin/organizations"
      />
      <div className="manage-form-shell">
        <DataForm
          title="Lưu tổ chức kiểm định"
          path="/organizations"
          extra={{ type: "AUDITOR" }}
          fields={[
            {
              name: "name",
              label: "Tên tổ chức kiểm định",
              required: true,
              maxLength: 255,
            },
          ]}
          onSaved={() => router.push("/admin/organizations")}
        />
      </div>
    </div>
  );
}
