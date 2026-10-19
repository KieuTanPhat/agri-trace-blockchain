"use client";
import Link from "next/link";
import type { components } from "@/lib/generated/api";
import { useWorkspaceData } from "@/lib/workspace";
import { statusLabels } from "@/lib/enterprise-onboarding";
import { RegistrationProfileDetails } from "@/components/workspace/registration-profile-details";
import { ProfileAmendments } from "@/components/workspace/profile-amendments";
import { LoadState, PageHeader } from "@/components/manage";
export default function OnboardingPage() {
  const state = useWorkspaceData<
      components["schemas"]["EnterpriseEnrollmentViewDto"]
    >("/enterprise-enrollments/mine"),
    row = state.data,
    details = row?.details as Record<string, unknown> | undefined;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title="Hồ sơ xét duyệt"
        description="Theo dõi quyết định của quản trị và bước tiếp theo để kích hoạt dịch vụ."
      />
      <LoadState {...state} />
      {row && (
        <section className="panel grid">
          <h2>{row.organizationName}</h2>
          <dl className="review-details">
            <dt>Mã số doanh nghiệp</dt>
            <dd>{row.businessId ?? "Chưa khai báo"}</dd>
            <dt>Trạng thái</dt>
            <dd>{statusLabels[row.status] ?? row.status}</dd>
            <dt>Email nhận thông báo</dt>
            <dd>{String(details?.contactEmail ?? row.representativeEmail)}</dd>
            <dt>Địa chỉ</dt>
            <dd>
              {[details?.address, details?.ward, details?.province]
                .filter(Boolean)
                .join(", ")}
            </dd>
            <dt>Ghi chú xét duyệt</dt>
            <dd>{row.reviewNote ?? "Chưa có quyết định"}</dd>
          </dl>
          {row.status === "PENDING_REVIEW" ? (
            <p className="notice">
              Hồ sơ phải đợi admin phê duyệt. Chưa cấp quyền tạo dữ liệu hay yêu
              cầu peer. Kết quả được gửi về email doanh nghiệp.
            </p>
          ) : row.status === "APPROVED" ? (
            <>
              <p className="notice">
                Hồ sơ đã được duyệt. Hoàn thiện dịch vụ, hợp đồng và thanh toán
                trước khi cấu hình peer.
              </p>
              <Link
                className="button"
                href={
                  ["ACTIVE", "ACTIVE_LEGACY"].includes(row.onboardingStage)
                    ? "/enterprise"
                    : "/enterprise/service"
                }
              >
                {["ACTIVE", "ACTIVE_LEGACY"].includes(row.onboardingStage)
                  ? "Mở doanh nghiệp"
                  : "Chọn dịch vụ & xem hợp đồng"}
              </Link>
            </>
          ) : (
            <p className="notice error">
              Hồ sơ chưa được duyệt. Xem ghi chú và trao đổi với quản trị về
              thông tin cần bổ sung; chưa thực hiện thanh toán.
            </p>
          )}
          <button className="button secondary" onClick={state.reload}>
            Cập nhật trạng thái
          </button>
          <RegistrationProfileDetails
            details={row.details}
            documents={row.documents}
          />
        </section>
      )}
      {row?.status === "REJECTED" && (
        <>
          <section className="panel">
            <h2>Bổ sung và gửi lại hồ sơ</h2>
            <p>
              Gửi bản điều chỉnh kèm giấy tờ mới. Khi admin chấp nhận bản điều
              chỉnh, hồ sơ quay lại hàng chờ xét duyệt; chưa cấp quyền nghiệp vụ
              trước quyết định mới.
            </p>
          </section>
          <ProfileAmendments />
        </>
      )}
    </div>
  );
}
