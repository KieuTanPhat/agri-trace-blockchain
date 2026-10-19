"use client";

import { useParams } from "next/navigation";
import { DataForm, type Field } from "@/components/data-form";
import { useAuth } from "@/lib/auth-store";
import {
  approvalOperationLabels,
  approvalStatusLabels,
  formatDateTime,
  type Approval,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

const note: Field = {
  name: "note",
  label: "Ghi chú quyết định (tối thiểu 10 ký tự, ghi vào nhật ký kiểm toán)",
  required: true,
  minLength: 10,
  maxLength: 1000,
};
const mfa: Field = {
  name: "mfaCode",
  header: "X-MFA-Code",
  label: "Mã xác thực MFA (bắt buộc nếu tài khoản đã bật MFA)",
  maxLength: 20,
};

export default function ApprovalPage() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const state = useWorkspaceData<Approval>(`/platform-approvals/${id}`);
  const approval = state.data;
  const mine = approval?.proposer.id === auth.user?.id;
  const open = approval?.effectiveStatus === "PENDING";
  const admin = auth.user?.role.code === "SYSTEM_ADMIN";
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title={
          approval
            ? (approvalOperationLabels[approval.operation] ??
              approval.operation)
            : "Chi tiết đề xuất"
        }
        description="Xem nội dung đã chuẩn hóa mà bạn sẽ phê duyệt. Người phê duyệt phải khác người đề xuất."
        back="/admin/approvals"
      />
      <LoadState {...state} />
      {approval && (
        <>
          <section className="manage-section manage-detail-section">
            <h2>Nội dung đề xuất</h2>
            <dl className="manage-detail-list">
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  {approvalStatusLabels[approval.effectiveStatus] ??
                    approval.effectiveStatus}
                </dd>
              </div>
              <div>
                <dt>Người đề xuất</dt>
                <dd>
                  {approval.proposer.fullName} ({approval.proposer.email})
                </dd>
              </div>
              <div>
                <dt>Lý do đề xuất</dt>
                <dd>{approval.proposerReason}</dd>
              </div>
              <div>
                <dt>Hết hạn</dt>
                <dd>{formatDateTime(approval.expiresAt)}</dd>
              </div>
              {approval.decidedBy && (
                <div>
                  <dt>Quyết định bởi</dt>
                  <dd>
                    {approval.decidedBy.fullName} ·{" "}
                    {approval.decidedAt
                      ? formatDateTime(approval.decidedAt)
                      : ""}
                  </dd>
                </div>
              )}
              {approval.decisionNote && (
                <div>
                  <dt>Ghi chú quyết định</dt>
                  <dd>{approval.decisionNote}</dd>
                </div>
              )}
            </dl>
            <pre className="manage-json" aria-label="Tham số đã chuẩn hóa">
              {JSON.stringify(approval.payload, null, 2)}
            </pre>
            <p className="manage-section-help">
              Mã băm nội dung: {approval.payloadHash}
            </p>
          </section>
          {open && admin && mine && (
            <section className="manage-section manage-detail-section">
              <h2>Hủy đề xuất</h2>
              <p className="manage-section-help">
                Bạn là người đề xuất nên không thể tự phê duyệt. Bạn có thể hủy
                đề xuất này.
              </p>
              <DataForm
                title="Hủy đề xuất"
                path={`/platform-approvals/${approval.id}/cancel`}
                extra={{ version: approval.version }}
                fields={[note]}
                onSaved={() => state.reload()}
              />
            </section>
          )}
          {open && admin && !mine && (
            <>
              <section className="manage-section manage-detail-section">
                <h2>Phê duyệt</h2>
                <p className="manage-section-help">
                  Thao tác được thực hiện ngay trong cùng giao dịch với quyết
                  định này.
                </p>
                <DataForm
                  title="Phê duyệt và thực hiện"
                  path={`/platform-approvals/${approval.id}/decision`}
                  extra={{ decision: "APPROVE", version: approval.version }}
                  fields={[note, mfa]}
                  onSaved={() => state.reload()}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Từ chối</h2>
                <DataForm
                  title="Từ chối đề xuất"
                  path={`/platform-approvals/${approval.id}/decision`}
                  extra={{ decision: "REJECT", version: approval.version }}
                  fields={[note]}
                  onSaved={() => state.reload()}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
