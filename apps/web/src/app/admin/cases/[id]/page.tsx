"use client";

import { useParams } from "next/navigation";
import { DataForm, type Field } from "@/components/data-form";
import { useAuth } from "@/lib/auth-store";
import {
  caseActionLabels,
  caseCategoryLabels,
  caseSeverityLabels,
  caseSourceLabels,
  caseStatusLabels,
  formatDateTime,
  type PlatformCaseDetail,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const note: Field = {
  name: "note",
  label: "Ghi chú (tối thiểu 10 ký tự, ghi vào lịch sử và nhật ký kiểm toán)",
  required: true,
  minLength: 10,
  maxLength: 2000,
};

export default function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const state = useWorkspaceData<PlatformCaseDetail>(`/platform-cases/${id}`);
  const organizations = useWorkspaceData<
    { id: string; name: string; type: string }[]
  >("/platform-cases/organization-options");
  const row = state.data;
  const writable =
    ["SYSTEM_ADMIN", "PLATFORM_CASE_MANAGER"].includes(
      auth.user?.role.code ?? "",
    ) &&
    row &&
    row.status !== "CLOSED";
  const reload = () => state.reload();
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title={row ? `#${row.caseNumber} · ${row.title}` : "Hồ sơ sự cố"}
        description="Hồ sơ chỉ gửi yêu cầu và thông báo cho doanh nghiệp được giao. Thu hồi lô là lệnh của doanh nghiệp sở hữu, không thực hiện ở đây."
        back="/admin/cases"
      />
      <LoadState {...state} />
      {row && (
        <>
          <section className="manage-section manage-detail-section">
            <h2>Thông tin hồ sơ</h2>
            <dl className="manage-detail-list">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  {caseStatusLabels[row.status] ?? row.status}
                  {row.overdue ? " · quá hạn phản hồi" : ""}
                </dd>
              </div>
              <div>
                <dt>Phân loại</dt>
                <dd>{caseCategoryLabels[row.category] ?? row.category}</dd>
              </div>
              <div>
                <dt>Mức độ</dt>
                <dd>{caseSeverityLabels[row.severity] ?? row.severity}</dd>
              </div>
              <div>
                <dt>Nguồn</dt>
                <dd>{caseSourceLabels[row.source] ?? row.source}</dd>
              </div>
              <div>
                <dt>Doanh nghiệp được giao</dt>
                <dd>{row.owner?.name ?? "Chưa giao"}</dd>
              </div>
              <div>
                <dt>Lô liên quan</dt>
                <dd>{row.lot?.lotCode ?? "Chưa gắn"}</dd>
              </div>
              <div>
                <dt>Hạn phản hồi</dt>
                <dd>
                  {row.responseDueAt ? formatDateTime(row.responseDueAt) : "—"}
                </dd>
              </div>
              {row.closeReason && (
                <div>
                  <dt>Lý do đóng</dt>
                  <dd>{row.closeReason}</dd>
                </div>
              )}
            </dl>
            <p>{row.description}</p>
          </section>
          <section className="manage-section manage-detail-section">
            <h2>Lịch sử (không thể sửa)</h2>
            <ol className="manage-timeline">
              {row.events.map((event) => (
                <li key={event.id}>
                  <strong>
                    {caseActionLabels[event.action] ?? event.action}
                  </strong>{" "}
                  <small>
                    {formatDateTime(event.createdAt)} · {event.actor.fullName}
                    {event.organization
                      ? ` (${event.organization.name})`
                      : ""}{" "}
                    ·{" "}
                    {event.visibility === "SHARED"
                      ? "doanh nghiệp thấy"
                      : "nội bộ"}
                  </small>
                  <p>{event.note}</p>
                </li>
              ))}
            </ol>
          </section>
          {writable && (
            <>
              <section className="manage-section manage-detail-section">
                <h2>Giao cho doanh nghiệp</h2>
                <DataForm
                  freezeOnUnknown
                  key={`assign-${row.version}`}
                  title="Giao hồ sơ"
                  path={`/platform-cases/${row.id}/assign`}
                  extra={{ version: row.version }}
                  fields={[
                    {
                      name: "ownerOrganizationId",
                      label: "Doanh nghiệp",
                      required: true,
                      options: (organizations.data ?? [])
                        .filter((org) => org.type !== "AUDITOR")
                        .map((org) => ({ value: org.id, label: org.name })),
                    },
                    {
                      name: "responseDueAt",
                      label: "Hạn phản hồi",
                      type: "datetime-local",
                    },
                    note,
                  ]}
                  onSaved={reload}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Phân loại</h2>
                <DataForm
                  freezeOnUnknown
                  key={`classify-${row.version}`}
                  title="Cập nhật phân loại"
                  path={`/platform-cases/${row.id}/classify`}
                  extra={{ version: row.version }}
                  fields={[
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
                    note,
                  ]}
                  onSaved={reload}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Gắn lô</h2>
                <DataForm
                  freezeOnUnknown
                  key={`lot-${row.version}`}
                  title="Gắn lô"
                  path={`/platform-cases/${row.id}/link-lot`}
                  extra={{ version: row.version }}
                  fields={[
                    {
                      name: "lotId",
                      label: "Mã lô (UUID)",
                      required: true,
                      pattern: "[0-9a-fA-F-]{36}",
                    },
                    note,
                  ]}
                  onSaved={reload}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Ghi chú</h2>
                <DataForm
                  freezeOnUnknown
                  key={`note-${row.events.length}`}
                  title="Thêm ghi chú"
                  path={`/platform-cases/${row.id}/notes`}
                  fields={[
                    {
                      name: "note",
                      label: "Nội dung",
                      required: true,
                      maxLength: 2000,
                    },
                    {
                      name: "visibility",
                      label: "Hiển thị",
                      options: [
                        { value: "INTERNAL", label: "Nội bộ nền tảng" },
                        {
                          value: "SHARED",
                          label: "Chia sẻ với doanh nghiệp được giao",
                        },
                      ],
                    },
                  ]}
                  onSaved={reload}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Leo thang</h2>
                <DataForm
                  freezeOnUnknown
                  key={`escalate-${row.version}`}
                  title="Leo thang hồ sơ"
                  path={`/platform-cases/${row.id}/escalate`}
                  extra={{ version: row.version }}
                  fields={[note]}
                  onSaved={reload}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Đóng hồ sơ</h2>
                <p className="manage-section-help">
                  Hồ sơ đã đóng không thể mở lại hay sửa.
                </p>
                <DataForm
                  freezeOnUnknown
                  key={`close-${row.version}`}
                  title="Đóng hồ sơ"
                  path={`/platform-cases/${row.id}/close`}
                  extra={{ version: row.version }}
                  fields={[
                    {
                      name: "reason",
                      label: "Lý do đóng (tối thiểu 10 ký tự)",
                      required: true,
                      minLength: 10,
                      maxLength: 2000,
                    },
                  ]}
                  onSaved={reload}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
