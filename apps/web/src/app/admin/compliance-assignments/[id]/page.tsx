"use client";

import { useParams, useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import type { components } from "@/lib/generated/api";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader, StatusBadge } from "@/components/manage";

type Assignment = components["schemas"]["AssignmentListDto"];
type Account = components["schemas"]["UserListDto"];

export default function AssignmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const assignments = useWorkspaceData<Assignment[]>("/compliance/assignments");
  const users = useWorkspaceData<Account[]>("/users");
  const assignment = assignments.data?.find((item) => item.id === id);
  const reviewer = users.data?.find(
    (item) => item.id === assignment?.reviewerUserId,
  );
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title={assignment?.farm.name ?? "Chi tiết phân công"}
        description="Xem người được phân công và lịch sử quyết định trước khi thu hồi."
        back="/admin/compliance-assignments"
      />
      <LoadState {...assignments} />
      <LoadState {...users} />
      {!assignments.loading && !assignments.error && !assignment && (
        <p className="notice error" role="alert">
          Không tìm thấy phân công.
        </p>
      )}
      {assignment && (
        <>
          <section className="manage-section manage-detail-section">
            <h2>Thông tin phân công</h2>
            <dl className="manage-detail-list">
              <div>
                <dt>Nông trại</dt>
                <dd>{assignment.farm.name}</dd>
              </div>
              <div>
                <dt>Người kiểm định</dt>
                <dd>{reviewer?.fullName ?? "Tài khoản không còn hoạt động"}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge
                    value={assignment.revokedAt ? "REVOKED" : "ACTIVE"}
                  />
                </dd>
              </div>
            </dl>
          </section>
          <section className="manage-section manage-detail-section">
            <h2>Lịch sử</h2>
            <ol className="manage-audit-list">
              {assignment.audits.map((audit) => (
                <li key={audit.id}>
                  <strong>
                    {audit.action === "GRANTED" ? "Cấp phân công" : "Thu hồi"}
                  </strong>
                  <span>{audit.recordedAt}</span>
                  <p>{audit.reason}</p>
                </li>
              ))}
            </ol>
          </section>
          {!assignment.revokedAt && (
            <div className="manage-form-shell">
              <DataForm
                title="Thu hồi phân công"
                path={`/compliance/assignments/${assignment.id}/revoke`}
                fields={[
                  {
                    name: "reason",
                    label: "Lý do thu hồi",
                    required: true,
                    maxLength: 1000,
                  },
                ]}
                onSaved={() => router.push("/admin/compliance-assignments")}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
