import { localized, t } from "./i18n";

/** Nhãn tiếng Việt và sắc thái hiển thị cho các giá trị enum của Backend. */
export type Tone = "ok" | "info" | "warn" | "danger" | "neutral" | "brand";

type Entry = [label: string, tone: Tone];
const table: Record<string, Record<string, Entry>> = {
  enrollment: {
    PENDING_REVIEW: ["Chờ xét duyệt", "info"],
    APPROVED: ["Đã duyệt", "ok"],
    REJECTED: ["Đã trả hồ sơ", "danger"],
    AWAITING_ACTIVATION: ["Chờ kích hoạt", "warn"],
    ACTIVE: ["Đang hoạt động", "ok"],
    ACTIVE_LEGACY: ["Hoạt động (hồ sơ cũ)", "ok"],
    OPERATOR_PROVISIONED: ["Do vận hành cấp", "neutral"],
  },
  request: {
    PENDING: ["Chờ xét", "info"],
    APPROVED: ["Đã duyệt", "ok"],
    REJECTED: ["Từ chối", "danger"],
    WITHDRAWN: ["Đã rút", "neutral"],
  },
  connection: {
    PENDING_REVIEW: ["Chờ duyệt", "info"],
    APPROVED: ["Đã chấp nhận", "ok"],
    REJECTED: ["Từ chối", "danger"],
  },
  approval: {
    PENDING: ["Chờ người duyệt", "info"],
    APPROVED: ["Đã phê duyệt", "ok"],
    REJECTED: ["Từ chối", "danger"],
    CANCELLED: ["Đã hủy", "neutral"],
    EXPIRED: ["Hết hạn", "neutral"],
  },
  account: {
    ACTIVE: ["Hoạt động", "ok"],
    INACTIVE: ["Vô hiệu hóa", "neutral"],
    LOCKED: ["Bị khóa", "danger"],
  },
  org: {
    ACTIVE: ["Hoạt động", "ok"],
    INACTIVE: ["Ngừng hoạt động", "neutral"],
  },
  outcome: {
    SUCCESS: ["Thành công", "ok"],
    DENIED: ["Bị từ chối", "danger"],
    FAILED: ["Lỗi", "warn"],
  },
  case: {
    OPEN: ["Mới tiếp nhận", "info"],
    ASSIGNED: ["Đã giao", "info"],
    ACKNOWLEDGED: ["DN đã nhận", "brand"],
    RESPONDED: ["DN đã phản hồi", "ok"],
    ESCALATED: ["Leo thang", "warn"],
    CLOSED: ["Đã đóng", "neutral"],
  },
  severity: {
    LOW: ["Thấp", "neutral"],
    MEDIUM: ["Trung bình", "info"],
    HIGH: ["Cao", "warn"],
    CRITICAL: ["Nghiêm trọng", "danger"],
  },
  ticket: {
    OPEN: ["Mới", "info"],
    IN_PROGRESS: ["Đang xử lý", "brand"],
    WAITING_CUSTOMER: ["Chờ doanh nghiệp", "warn"],
    RESOLVED: ["Đã giải quyết", "ok"],
    CLOSED: ["Đã đóng", "neutral"],
  },
  priority: {
    LOW: ["Thấp", "neutral"],
    NORMAL: ["Bình thường", "info"],
    HIGH: ["Cao", "warn"],
    URGENT: ["Khẩn", "danger"],
  },
  report: {
    NEW: ["Chưa phân loại", "info"],
    ESCALATED: ["Đã chuyển sự cố", "warn"],
    DISMISSED: ["Bác bỏ", "neutral"],
    DUPLICATE: ["Trùng", "neutral"],
  },
  privacy: {
    NEW: ["Mới", "info"],
    IN_REVIEW: ["Đang xem xét", "brand"],
    RESPONDED: ["Đã phản hồi", "ok"],
    CLOSED: ["Đã đóng", "neutral"],
    REJECTED: ["Từ chối", "danger"],
  },
  reporting: {
    UNASSESSED: ["Chưa đánh giá", "warn"],
    REQUIRED: ["Phải báo cáo", "danger"],
    NOT_REQUIRED: ["Không thuộc diện", "ok"],
  },
  invoice: {
    ISSUED: ["Chờ thanh toán", "info"],
    PAID: ["Đã thanh toán", "ok"],
    VOID: ["Đã hủy", "neutral"],
  },
  subscription: {
    ACTIVE: ["Hiệu lực", "ok"],
    GRACE: ["Ân hạn", "warn"],
    RESTRICTED: ["Bị hạn chế", "danger"],
    PENDING_PAYMENT: ["Chờ thanh toán", "info"],
    CANCELLED: ["Đã hủy", "neutral"],
    FREE: ["Miễn phí", "neutral"],
    NONE: ["Chưa có gói", "warn"],
  },
  plan: {
    DRAFT: ["Bản nháp", "warn"],
    PUBLISHED: ["Đã công bố", "ok"],
  },
  lot: {
    AVAILABLE: ["Sẵn có", "ok"],
    IN_DISTRIBUTION: ["Đang phân phối", "info"],
    SOLD: ["Đã bán", "neutral"],
    RECALLED: ["Đã thu hồi", "danger"],
    EXPIRED: ["Hết hạn", "neutral"],
    CONSUMED: ["Đã chế biến hết", "neutral"],
    DAMAGED: ["Hư hỏng", "warn"],
  },
  outbox: {
    PENDING: ["Chờ gửi", "info"],
    PROCESSING: ["Đang gửi", "brand"],
    RETRY: ["Thử lại", "warn"],
    COMPLETED: ["Hoàn tất", "ok"],
    DEAD_LETTER: ["Lỗi vĩnh viễn", "danger"],
  },
  ledgerJob: {
    PENDING: ["Chờ", "info"],
    PROCESSING: ["Đang chạy", "brand"],
    FAILED: ["Lỗi", "danger"],
    COMPLETED: ["Hoàn tất", "ok"],
  },
  mail: {
    PENDING: ["Chờ gửi", "info"],
    SENT: ["Đã gửi", "ok"],
    CANCELLED: ["Đã hủy", "neutral"],
  },
  tx: {
    PENDING: ["Chờ xác nhận", "info"],
    CONFIRMED: ["Đã xác nhận", "ok"],
    FAILED: ["Thất bại", "danger"],
  },
  check: {
    OK: ["Ổn định", "ok"],
    SLOW: ["Chậm", "warn"],
    WARN: ["Cảnh báo", "warn"],
    ALERT: ["Báo động", "danger"],
  },
  chain: {
    ACTIVE: ["Hoạt động", "ok"],
    SUSPENDED: ["Tạm dừng", "warn"],
    NONE: ["Chưa cấu hình", "neutral"],
    DEGRADED: ["Suy giảm", "danger"],
  },
  notice: {
    PUBLISHED: ["Đã đăng", "ok"],
    WITHDRAWN: ["Đã thu hồi", "neutral"],
  },
  noticeSeverity: {
    INFO: ["Thông tin", "info"],
    WARNING: ["Cảnh báo", "warn"],
    MAINTENANCE: ["Bảo trì", "brand"],
  },
  ref: {
    ACTIVE: ["Đang dùng", "ok"],
    INACTIVE: ["Ngừng dùng", "neutral"],
  },
};

export function label(group: keyof typeof table, value?: string | null): Entry {
  if (!value) return ["—", "neutral"];
  const e = table[group]?.[value];
  return e ? [t(e[0]), e[1]] : [value, "neutral"];
}

export const CAPABILITY_LABEL: Record<string, string> = localized({
  FARM: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  PROCESSOR: "Chế biến",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
  AUDITOR: "Kiểm định",
});
export const ORG_TYPE_LABEL: Record<string, string> = CAPABILITY_LABEL;
export const MODEL_LABEL: Record<string, string> = localized({
  SINGLE: "Một hoạt động",
  SUPPLY_CHAIN_ENTERPRISE: "Doanh nghiệp chuỗi",
  NONE: "Không áp dụng",
});
export const INBOX_KIND_LABEL: Record<string, string> = localized({
  ENROLLMENT: "Hồ sơ",
  CAPABILITY: "Năng lực",
  AMENDMENT: "Điều chỉnh",
  CONNECTION: "Kết nối",
  APPROVAL: "Phê duyệt",
  TICKET: "Hỗ trợ",
  CONSUMER_REPORT: "Báo cáo NTD",
  CASE: "Sự cố",
  INVOICE_OVERDUE: "Hóa đơn",
});
export const CASE_CATEGORY_LABEL: Record<string, string> = localized({
  QUALITY: "Chất lượng",
  SAFETY: "An toàn",
  LABELING: "Ghi nhãn",
  COUNTERFEIT: "Hàng giả",
  OTHER: "Khác",
});
export const CASE_SOURCE_LABEL: Record<string, string> = localized({
  CONSUMER: "Người tiêu dùng",
  ENTERPRISE: "Doanh nghiệp",
  AUDITOR: "Kiểm toán",
  INTERNAL: "Nội bộ",
});
export const OPERATION_LABEL: Record<string, string> = localized({
  CAPABILITY_GRANT: "Cấp năng lực tổ chức",
  CREATE_CHAIN_GRANT: "Cấp quyền tạo chuỗi",
  SYSTEM_ADMIN_CREATE: "Tạo tài khoản quản trị",
  CONNECTION_APPROVE: "Chấp nhận kết nối peer",
  ADMIN_PASSWORD_RESET: "Đặt lại mật khẩu quản trị",
  CAPABILITY_REQUEST_APPROVE: "Duyệt yêu cầu năng lực",
  PLAN_VERSION_PUBLISH: "Công bố bảng giá",
  INVOICE_CONFIRM_PAYMENT: "Xác nhận thanh toán",
  SETTING_CHANGE: "Đổi tham số nền tảng",
  QR_BLOCK: "Khóa QR lô",
  ENROLLMENT_APPROVE: "Phê duyệt hồ sơ doanh nghiệp",
});
export const DOC_KIND_LABEL: Record<string, string> = localized({
  LEGAL_REGISTRATION: "Giấy đăng ký",
  AUTHORIZATION: "Giấy ủy quyền",
  CERTIFICATE: "Chứng nhận",
  LOGO: "Logo",
});
export const REF_CATEGORY_LABEL: Record<string, string> = localized({
  UNIT: "Đơn vị tính",
  PRODUCT_CATEGORY: "Nhóm sản phẩm",
  CERTIFICATE_TYPE: "Loại chứng nhận",
  LOSS_REASON: "Lý do hao hụt",
  PROCESSING_TYPE: "Loại hình chế biến",
  TICKET_CATEGORY: "Chủ đề hỗ trợ",
});
export const AUDIENCE_LABEL: Record<string, string> = localized({
  ALL: "Tất cả",
  PLATFORM: "Nền tảng",
  ENTERPRISE: "Mọi doanh nghiệp",
  FARM: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  PROCESSOR: "Chế biến",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
});
