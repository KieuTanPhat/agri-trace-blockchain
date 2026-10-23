import type { components } from "./generated/api";
import { request } from "./api-client";
export type Enrollment = components["schemas"]["EnterpriseEnrollmentViewDto"];
export type Connection = components["schemas"]["EnterpriseConnectionViewDto"];
export type Registration = components["schemas"]["RegisterDto"];
export const hostingLabels: Record<string, string> = {
  MANAGED_ORG: "AgriTrace quản lý peer",
  SELF_MANAGED_ORG: "Tự vận hành peer trên VPS",
};
export const statusLabels: Record<string, string> = {
  PENDING_REVIEW: "Chờ xét duyệt",
  APPROVED: "Hồ sơ đã được duyệt",
  REJECTED: "Cần xử lý hồ sơ",
  CHECKING: "Đang kiểm chứng trên Fabric",
  UNKNOWN: "Đang đối soát kết quả giao dịch",
  CONNECTED: "Đã kiểm chứng kết nối",
  FAILED: "Kết nối cần được xử lý",
};
export const errorLabels: Record<string, string> = {
  CONNECTION_UNAVAILABLE:
    "Chưa liên lạc được với peer. Hệ thống sẽ kiểm tra lại.",
  CONNECTION_CONFIG_NOT_APPROVED:
    "Thông tin peer chưa khớp cấu hình vận hành đã duyệt.",
  CONNECTION_RECONCILING:
    "Đang tìm kết quả giao dịch cũ; giữ nguyên yêu cầu này.",
  CONNECTION_CAPABILITY_MISMATCH: "Peer chưa chạy phiên bản hợp đồng phù hợp.",
  CONNECTION_BINDING_MISMATCH: "Chuỗi chưa có cấu hình mạng hoạt động phù hợp.",
  CONNECTION_SCOPE_MISMATCH: "Quyền của doanh nghiệp đã thay đổi.",
  CONNECTION_COMMIT_INVALID: "Giao dịch kiểm tra bị Fabric từ chối.",
  CONNECTION_PREPARE_INTERRUPTED:
    "Kiểm tra bị gián đoạn trước khi gửi. Có thể tạo yêu cầu mới.",
  CONNECTION_MSP_ALREADY_ASSIGNED:
    "Định danh tổ chức trên mạng đã được cấp cho doanh nghiệp khác.",
  CONNECTION_PROOF_MISMATCH:
    "Bằng chứng giữa các peer chưa khớp; cần vận hành đối soát.",
};
export const registerEnterprise = (input: Registration) =>
  request<components["schemas"]["EnterpriseRegistrationReceiptDto"]>(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
    false,
  );
export const getEnrollment = () =>
  request<Enrollment>("/enterprise-enrollments/mine");
export const connectEnterprise = (
  input: components["schemas"]["EnterpriseConnectionDto"],
  key: string,
) =>
  request<Connection>("/enterprise-connections", {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(input),
  });
export const reviewEnterprise = (
  kind: "enterprise-enrollments" | "enterprise-connections",
  id: string,
  input: components["schemas"]["ReviewEnterpriseDto"],
  key: string,
) =>
  request(`/${kind}/${id}/review`, {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify(input),
  });
export const onboardingError = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Chưa hoàn thành yêu cầu. Giữ nguyên thông tin và thử lại.";
