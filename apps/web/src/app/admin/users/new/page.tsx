"use client";
import { Button } from "@/components/ui/button";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DataForm } from "@/components/data-form";
import { useWorkspaceData } from "@/lib/workspace";
import { platformAdminLabels } from "@/lib/permissions";
import { LoadState, PageHeader } from "@/components/manage";

type AuditorOrg = { id: string; name: string; type: string; status: string };

export default function NewPlatformUserPage() {
  const router = useRouter();
  const [role, setRole] = useState<string>("COMPLIANCE_REVIEWER");
  const organizations = useWorkspaceData<AuditorOrg[]>("/organizations");
  const auditorOptions = (organizations.data ?? [])
    .filter((item) => item.type === "AUDITOR" && item.status === "ACTIVE")
    .map((item) => ({ value: item.id, label: item.name }));
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Tạo tài khoản nền tảng"
        description="Chỉ tạo quản trị viên nội bộ hoặc người kiểm định độc lập. Doanh nghiệp tự quản lý nhân viên của mình. Mật khẩu tạm được gửi tới email đăng nhập và phải đổi ở lần đăng nhập đầu tiên."
        back="/admin/users"
      />
      <LoadState {...organizations} />
      <div className="manage-choice" role="group" aria-label="Loại tài khoản">
        <Button
          type="button"
          aria-pressed={role === "COMPLIANCE_REVIEWER"}
          onClick={() => setRole("COMPLIANCE_REVIEWER")}
        >
          Người kiểm định
        </Button>
        {Object.entries(platformAdminLabels)
          .filter(([code]) => code !== "SYSTEM_ADMIN")
          .map(([code, label]) => (
            <Button
              type="button"
              key={code}
              aria-pressed={role === code}
              onClick={() => setRole(code)}
            >
              {label}
            </Button>
          ))}
        <Button
          type="button"
          aria-pressed={role === "SYSTEM_ADMIN"}
          onClick={() => setRole("SYSTEM_ADMIN")}
        >
          Quản trị viên
        </Button>
      </div>
      {role === "COMPLIANCE_REVIEWER" &&
        !organizations.loading &&
        !auditorOptions.length && (
          <p className="notice" role="status">
            Chưa có tổ chức kiểm định đang hoạt động. Tạo tổ chức kiểm định
            trước khi cấp tài khoản.
          </p>
        )}
      <div className="manage-form-shell">
        <DataForm
          key={role}
          title={
            role === "COMPLIANCE_REVIEWER"
              ? "Tạo người kiểm định"
              : `Tạo ${platformAdminLabels[role]}`
          }
          path="/users"
          extra={{ roleCode: role }}
          fields={[
            {
              name: "fullName",
              label: "Họ và tên",
              required: true,
              maxLength: 255,
            },
            {
              name: "email",
              label: "Email đăng nhập",
              type: "email",
              required: true,
            },
            ...(role === "COMPLIANCE_REVIEWER"
              ? [
                  {
                    name: "organizationId",
                    label: "Tổ chức kiểm định",
                    required: true,
                    options: auditorOptions,
                  },
                ]
              : []),
          ]}
          onSaved={() => router.push("/admin/users")}
        />
      </div>
    </div>
  );
}
