"use client";

import { useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import {
  caseCategoryLabels,
  caseSeverityLabels,
  caseSourceLabels,
  type PlatformCase,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));

export default function NewCasePage() {
  const router = useRouter();
  const organizations = useWorkspaceData<
    { id: string; name: string; type: string }[]
  >("/platform-cases/organization-options");
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Tiếp nhận hồ sơ sự cố"
        description="Không ghi dữ liệu cá nhân của người khiếu nại: nội dung được gửi cho doanh nghiệp được giao. Nếu gắn lô mà không chọn doanh nghiệp, hồ sơ giao cho doanh nghiệp sản xuất lô."
        back="/admin/cases"
      />
      <LoadState {...organizations} />
      <div className="manage-form-shell">
        <DataForm
          freezeOnUnknown
          title="Tiếp nhận hồ sơ"
          path="/platform-cases"
          fields={[
            {
              name: "title",
              label: "Tiêu đề",
              required: true,
              minLength: 5,
              maxLength: 200,
            },
            {
              name: "description",
              label: "Mô tả sự cố (tối thiểu 10 ký tự)",
              required: true,
              minLength: 10,
              maxLength: 4000,
            },
            {
              name: "category",
              label: "Phân loại",
              required: true,
              options: options(caseCategoryLabels),
            },
            {
              name: "severity",
              label: "Mức độ",
              required: true,
              options: options(caseSeverityLabels),
            },
            {
              name: "source",
              label: "Nguồn tiếp nhận",
              required: true,
              options: options(caseSourceLabels),
            },
            {
              name: "lotId",
              label: "Mã lô liên quan (UUID, nếu có)",
              pattern: "[0-9a-fA-F-]{36}",
            },
            {
              name: "ownerOrganizationId",
              label: "Doanh nghiệp được giao (nếu có)",
              options: (organizations.data ?? [])
                .filter((org) => org.type !== "AUDITOR")
                .map((org) => ({ value: org.id, label: org.name })),
            },
            {
              name: "responseDueAt",
              label: "Hạn phản hồi (cần có doanh nghiệp được giao)",
              type: "datetime-local",
            },
          ]}
          onSaved={(result) =>
            router.push(`/admin/cases/${(result as PlatformCase).id}`)
          }
        />
      </div>
    </div>
  );
}
