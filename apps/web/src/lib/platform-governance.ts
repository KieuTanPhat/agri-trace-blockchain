import type { components } from "./generated/api";

type Schemas = components["schemas"];
export type AuditPage = Schemas["PlatformAuditPageDto"];
export type AuditExport = Schemas["PlatformAuditExportDto"];
export type AuditVerification = Schemas["PlatformAuditVerificationDto"];
export type MfaStatus = Schemas["MfaStatusDto"];
export type OperationsSummary = Schemas["OperationsSummaryDto"];
export type PlatformCase = Schemas["PlatformCaseDto"];
export type PlatformCaseDetail = Schemas["PlatformCaseDetailDto"];
export type PlatformCasePage = Schemas["PlatformCasePageDto"];
export type EnterpriseCase = Schemas["EnterpriseCaseDto"];
export type CredentialsOverview = Schemas["CredentialsOverviewDto"];

export const auditActionLabels: Record<string, string> = {
  PRIVACY_REQUEST_CREATED: "Tiếp nhận yêu cầu quyền dữ liệu",
  PRIVACY_BREACH_CREATED: "Ghi nhận sự cố dữ liệu cá nhân",
  PRIVACY_TICKET_UPDATED: "Xử lý hồ sơ dữ liệu cá nhân",
  PLATFORM_SECRET_ROTATED: "Xoay khóa mã hóa nền tảng",
  SERVICE_PAYMENT_SIMULATED: "Hoàn tất thanh toán mô phỏng",
  USER_CREATED: "Tạo tài khoản",
  USER_STATUS_CHANGED: "Đổi trạng thái tài khoản",
  USER_UNLOCKED: "Mở khóa đăng nhập",
  USER_LOGIN_LOCKED: "Khóa tạm do đăng nhập sai",
  USER_SESSIONS_REVOKED: "Thu hồi phiên đăng nhập",
  USER_SESSIONS_REVOKED_SELF: "Tự đăng xuất mọi phiên",
  USER_PASSWORD_RESET: "Đặt lại mật khẩu",
  PASSWORD_CHANGED: "Đổi mật khẩu",
  MFA_ENROLLMENT_STARTED: "Bắt đầu đăng ký MFA",
  MFA_ENABLED: "Bật MFA",
  MFA_DISABLED: "Tắt MFA",
  MFA_RECOVERY_REGENERATED: "Cấp lại mã khôi phục MFA",
  ORGANIZATION_CREATED: "Tạo tổ chức",
  ORGANIZATION_UPDATED: "Cập nhật tổ chức",
  ORGANIZATION_STATUS_CHANGED: "Đổi trạng thái tổ chức",
  ENROLLMENT_APPROVED: "Duyệt hồ sơ doanh nghiệp",
  ENROLLMENT_REJECTED: "Từ chối hồ sơ doanh nghiệp",
  CONNECTION_APPROVED: "Chấp nhận kết nối peer",
  CONNECTION_REJECTED: "Từ chối kết nối peer",
  CAPABILITY_GRANTED: "Cấp năng lực tổ chức",
  ROLE_GRANTED: "Cấp vai trò",
  ROLE_REVOKED: "Thu hồi vai trò",
  APPROVAL_PROPOSED: "Đề xuất phê duyệt",
  APPROVAL_APPROVED: "Phê duyệt đề xuất",
  APPROVAL_REJECTED: "Từ chối đề xuất",
  APPROVAL_CANCELLED: "Hủy đề xuất",
  APPROVAL_EXPIRED: "Đề xuất hết hạn",
  CASE_CREATED: "Tạo hồ sơ sự cố",
  CASE_CLASSIFIED: "Phân loại hồ sơ sự cố",
  CASE_ASSIGNED: "Giao hồ sơ sự cố",
  CASE_LOT_LINKED: "Gắn lô vào hồ sơ sự cố",
  CASE_NOTE_ADDED: "Ghi chú hồ sơ sự cố",
  CASE_ESCALATED: "Leo thang hồ sơ sự cố",
  CASE_CLOSED: "Đóng hồ sơ sự cố",
  COMPLIANCE_ASSIGNMENT_GRANTED: "Phân công kiểm định",
  COMPLIANCE_ASSIGNMENT_REVOKED: "Thu hồi phân công kiểm định",
};

export const approvalOperationLabels: Record<string, string> = {
  CAPABILITY_GRANT: "Cấp năng lực cho tổ chức",
  CREATE_CHAIN_GRANT: "Cấp quyền tạo chuỗi truy xuất",
  SYSTEM_ADMIN_CREATE: "Tạo quản trị viên mới",
  CONNECTION_APPROVE: "Chấp nhận kết nối peer",
  ADMIN_PASSWORD_RESET: "Đặt lại mật khẩu quản trị viên",
  CAPABILITY_REQUEST_APPROVE: "Duyệt năng lực doanh nghiệp",
  PLAN_VERSION_PUBLISH: "Công bố bảng giá gói dịch vụ",
  INVOICE_CONFIRM_PAYMENT: "Xác nhận thanh toán hóa đơn",
  SETTING_CHANGE: "Đổi tham số nền tảng",
  QR_BLOCK: "Khóa mã QR",
};

export const approvalStatusLabels: Record<string, string> = {
  PENDING: "Chờ phê duyệt",
  APPROVED: "Đã phê duyệt",
  REJECTED: "Đã từ chối",
  CANCELLED: "Đã hủy",
  EXPIRED: "Đã hết hạn",
};

export const formatDateTime = (value: string | Date) =>
  new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));

/** Saves text produced by the API (CSV export) without a server round trip. */
export function downloadText(filename: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Human-readable duration for queue ages (seconds in, Vietnamese out). */
export function formatAge(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${seconds} giây`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} phút`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} giờ`;
  return `${Math.round(hours / 24)} ngày`;
}

export const caseStatusLabels: Record<string, string> = {
  OPEN: "Mới tiếp nhận",
  ASSIGNED: "Đã giao, chờ xác nhận",
  ACKNOWLEDGED: "Doanh nghiệp đã nhận",
  RESPONDED: "Đã phản hồi",
  ESCALATED: "Đã leo thang",
  CLOSED: "Đã đóng",
};
export const caseCategoryLabels: Record<string, string> = {
  QUALITY: "Chất lượng",
  SAFETY: "An toàn thực phẩm",
  LABELING: "Nhãn / truy xuất",
  COUNTERFEIT: "Nghi giả mạo",
  OTHER: "Khác",
};
export const caseSeverityLabels: Record<string, string> = {
  LOW: "Thấp",
  MEDIUM: "Trung bình",
  HIGH: "Cao",
  CRITICAL: "Nghiêm trọng",
};
export const caseSourceLabels: Record<string, string> = {
  CONSUMER: "Người tiêu dùng",
  ENTERPRISE: "Doanh nghiệp",
  AUDITOR: "Đơn vị kiểm định",
  INTERNAL: "Nội bộ nền tảng",
};
export const caseActionLabels: Record<string, string> = {
  CREATED: "Tiếp nhận",
  CLASSIFIED: "Phân loại",
  LOT_LINKED: "Gắn lô",
  ASSIGNED: "Giao cho doanh nghiệp",
  ACKNOWLEDGED: "Doanh nghiệp xác nhận",
  RESPONDED: "Doanh nghiệp phản hồi",
  ESCALATED: "Leo thang",
  NOTE: "Ghi chú",
  CLOSED: "Đóng hồ sơ",
};
