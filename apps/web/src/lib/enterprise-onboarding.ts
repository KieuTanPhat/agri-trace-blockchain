import type { components } from "./generated/api";
import { request } from "./api-client";
export type Enrollment = components["schemas"]["EnterpriseEnrollmentViewDto"];
export type Registration = components["schemas"]["RegisterDto"];
export const statusLabels: Record<string, string> = {
  PENDING_REVIEW: "Chờ xét duyệt",
  APPROVED: "Hồ sơ đã được duyệt",
  REJECTED: "Cần xử lý hồ sơ",
  CHECKING: "Đang kiểm chứng trên Fabric",
  UNKNOWN: "Đang đối soát kết quả giao dịch",
  CONNECTED: "Đã kiểm chứng kết nối",
  FAILED: "Kết nối cần được xử lý",
};
export const registerEnterprise = (input: Registration) =>
  request<components["schemas"]["EnterpriseRegistrationReceiptDto"]>(
    "/auth/register",
    { method: "POST", body: JSON.stringify(input) },
    false,
  );
export const getEnrollment = () =>
  request<Enrollment>("/enterprise-enrollments/mine");
export const reviewEnterprise = (
  kind: "enterprise-enrollments",
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
