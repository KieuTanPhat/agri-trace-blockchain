"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import { errorLabels, statusLabels } from "@/lib/enterprise-onboarding";
import { useWorkspaceData } from "@/lib/workspace";
import { ReviewDecision } from "@/components/workspace/platform-enrollment";
import {
  LoadState,
  PageHeader,
  ReloadButton,
  StatusBadge,
} from "@/components/manage";

export default function ConnectionReviewPage() {
  const { id, connectionId } = useParams<{
    id: string;
    connectionId: string;
  }>();
  const auth = useAuth();
  const state = useWorkspaceData<Enrollment>(`/enterprise-enrollments/${id}`);
  const connection = state.data?.connections.find(
    (item) => item.id === connectionId,
  );
  if (auth.user?.role.code !== "SYSTEM_ADMIN")
    return (
      <p className="notice error" role="alert">
        Bạn không có quyền xét duyệt kết nối.
      </p>
    );
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Yêu cầu kết nối"
        description="Kiểm tra cấu hình công khai trước khi chuyển yêu cầu cho vận hành mạng."
        back={`/admin/enterprises/${id}`}
      />
      <LoadState {...state} />
      {!state.loading && !state.error && !connection && (
        <p className="notice error" role="alert">
          Không tìm thấy yêu cầu kết nối trong hồ sơ này.
        </p>
      )}
      {connection && (
        <>
          <section className="manage-section manage-detail-section">
            <div className="manage-detail-title">
              <div>
                <p className="manage-overline">
                  {state.data?.organizationName}
                </p>
                <h2>{statusLabels[connection.status] ?? connection.status}</h2>
              </div>
              <StatusBadge value={connection.status} />
            </div>
            <dl className="manage-detail-list">
              <div>
                <dt>Mã yêu cầu</dt>
                <dd>{connection.id}</dd>
              </div>
              <div>
                <dt>Mã chuỗi</dt>
                <dd>{connection.chainId}</dd>
              </div>
              <div>
                <dt>Gửi lúc</dt>
                <dd>
                  {new Intl.DateTimeFormat("vi-VN", {
                    timeZone: "Asia/Ho_Chi_Minh",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(connection.createdAt))}
                </dd>
              </div>
              {connection.txId && (
                <div>
                  <dt>Giao dịch</dt>
                  <dd>{connection.txId}</dd>
                </div>
              )}
            </dl>
            <div className="manage-detail-actions">
              <ReloadButton onClick={state.reload} />
            </div>
          </section>
          {connection.errorCode && (
            <p className="notice" role="status">
              {errorLabels[connection.errorCode] ?? "Cần vận hành kiểm tra."}
            </p>
          )}
          {connection.reviewNote && (
            <section className="manage-section manage-detail-section">
              <h2>Ghi chú xét duyệt</h2>
              <p>{connection.reviewNote}</p>
            </section>
          )}
          <section className="manage-section manage-detail-section">
            <h2>Thông tin kết nối công khai</h2>
            <p className="manage-section-help">
              Chỉ gồm endpoint và chứng thư công khai; không nhập khóa riêng.
            </p>
            <details className="manage-config-details">
              <summary>Xem cấu hình đã gửi</summary>
              <pre>{JSON.stringify(connection.publicConfig, null, 2)}</pre>
            </details>
          </section>
          {connection.status === "PENDING_REVIEW" && (
            <section className="manage-section manage-detail-section">
              <h2>Quyết định yêu cầu kết nối</h2>
              <p className="manage-section-help">
                Phê duyệt chỉ đưa yêu cầu vào quy trình kiểm chứng mạng; trạng
                thái kết nối được xác nhận sau giao dịch Fabric hợp lệ.
              </p>
              <p className="manage-section-help">
                Khi chính sách phê duyệt hai bước được bật, việc chấp nhận kết
                nối cần một quản trị viên khác duyệt;{" "}
                <Link
                  className="text-link"
                  href={`/admin/approvals/new?operation=CONNECTION_APPROVE&connectionId=${connection.id}`}
                >
                  gửi đề xuất chấp nhận kết nối này
                </Link>
                . Từ chối vẫn xử lý trực tiếp tại đây.
              </p>
              <ReviewDecision
                kind="enterprise-connections"
                id={connection.id}
                version={connection.version}
                onDone={async () => state.reload()}
              />
            </section>
          )}
        </>
      )}
    </div>
  );
}
