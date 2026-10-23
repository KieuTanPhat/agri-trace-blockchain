/** Labels and formatting for the platform administration console. Endpoints
 * under /platform-admin and /platform-billing return plain records. */
export type Row = Record<string, unknown>;
export type Items<T = Row> = { items: T[] };
export type RecordOf<T = Row> = { record: T };

export const text = (value: unknown) =>
  value === null || value === undefined || value === "" ? "—" : String(value);

export const money = (value: unknown) =>
  typeof value === "number"
    ? `${value.toLocaleString("vi-VN")} ₫`
    : text(value);

export const shortDate = (value: unknown) =>
  typeof value === "string" && value
    ? new Date(value).toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";

export const dateTime = (value: unknown) =>
  typeof value === "string" && value
    ? new Date(value).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })
    : "—";

export const capabilityLabels: Record<string, string> = {
  FARM: "Nhà sản xuất/HTX",
  TRANSPORTER: "Vận chuyển",
  PROCESSOR: "Chế biến",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
  AUDITOR: "Kiểm định",
};
export const participationLabels: Record<string, string> = {
  SINGLE: "Một vai trò",
  SUPPLY_CHAIN_ENTERPRISE: "Doanh nghiệp chuỗi cung ứng",
};
export const subscriptionLabels: Record<string, string> = {
  ACTIVE: "Đang hiệu lực",
  GRACE: "Trong ân hạn",
  RESTRICTED: "Hạn chế (quá hạn)",
  PENDING_PAYMENT: "Chờ thanh toán",
  CANCELLED: "Đã hủy",
  PARTICIPANT: "Tham gia miễn phí",
  UNRESTRICTED: "Không áp hạn mức",
  NONE: "Chưa có gói",
};
export const invoiceLabels: Record<string, string> = {
  ISSUED: "Chờ thanh toán",
  PAID: "Đã thanh toán",
  VOID: "Đã hủy",
};
export const ticketStatusLabels: Record<string, string> = {
  OPEN: "Mới",
  IN_PROGRESS: "Đang xử lý",
  WAITING_CUSTOMER: "Chờ doanh nghiệp",
  RESOLVED: "Đã giải quyết",
  CLOSED: "Đã đóng",
};
export const ticketCategoryLabels: Record<string, string> = {
  ACCOUNT: "Tài khoản",
  BILLING: "Thanh toán",
  TECHNICAL: "Kỹ thuật",
  TRACEABILITY: "Truy xuất",
  BLOCKCHAIN: "Blockchain",
  PROCESSING: "Chế biến",
  OTHER: "Khác",
};
export const priorityLabels: Record<string, string> = {
  LOW: "Thấp",
  NORMAL: "Bình thường",
  HIGH: "Cao",
  URGENT: "Khẩn",
};
export const reportCategoryLabels: Record<string, string> = {
  COUNTERFEIT: "Nghi hàng giả",
  WRONG_INFORMATION: "Thông tin sai",
  QUALITY: "Chất lượng",
  SAFETY: "An toàn thực phẩm",
  EXPIRED: "Hết hạn",
  OTHER: "Khác",
};
export const reportStatusLabels: Record<string, string> = {
  NEW: "Mới",
  ESCALATED: "Đã chuyển hồ sơ sự cố",
  DISMISSED: "Không xử lý",
  DUPLICATE: "Trùng lặp",
};
export const inboxKindLabels: Record<string, string> = {
  ENROLLMENT: "Hồ sơ đăng ký",
  CAPABILITY: "Năng lực",
  AMENDMENT: "Điều chỉnh hồ sơ",
  CONNECTION: "Kết nối blockchain",
  APPROVAL: "Phê duyệt hai bước",
  TICKET: "Yêu cầu hỗ trợ",
  CONSUMER_REPORT: "Báo cáo người tiêu dùng",
  CASE: "Sự cố",
  INVOICE_OVERDUE: "Hóa đơn quá hạn",
};
export const processTypeLabels: Record<string, string> = {
  PRELIMINARY: "Sơ chế",
  PACKING: "Đóng gói",
  DRYING: "Sấy",
  FREEZING: "Cấp đông",
  MILLING: "Xay xát",
  JUICE_EXTRACT: "Ép, chiết",
  FERMENTING: "Lên men",
  OTHER: "Khác",
};
export const lossReasonLabels: Record<string, string> = {
  TRIMMING: "Cắt tỉa, loại bỏ",
  MOISTURE: "Hao hụt độ ẩm",
  SPILLAGE: "Rơi vãi",
  QUALITY_REJECT: "Loại do chất lượng",
  SAMPLING: "Lấy mẫu",
  OTHER: "Khác",
};
export const runStatusLabels: Record<string, string> = {
  DRAFT: "Nháp",
  COMPLETED: "Đã hoàn tất",
  CANCELLED: "Đã hủy",
};
export const noticeSeverityLabels: Record<string, string> = {
  INFO: "Thông tin",
  WARNING: "Cảnh báo",
  MAINTENANCE: "Bảo trì",
};
export const noticeAudienceLabels: Record<string, string> = {
  ALL: "Tất cả",
  PLATFORM: "Nhân sự nền tảng",
  ENTERPRISE: "Mọi doanh nghiệp",
  FARM: "Nhà sản xuất/HTX",
  TRANSPORTER: "Vận chuyển",
  PROCESSOR: "Chế biến",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
};
export const referenceCategoryLabels: Record<string, string> = {
  UNIT: "Đơn vị tính",
  PRODUCT_CATEGORY: "Nhóm sản phẩm",
  CERTIFICATE_TYPE: "Loại chứng nhận",
  LOSS_REASON: "Lý do hao hụt",
  PROCESSING_TYPE: "Loại chế biến",
  TICKET_CATEGORY: "Loại yêu cầu hỗ trợ",
};
export const resourceLabels: Record<string, string> = {
  products: "Sản phẩm",
  chains: "Chuỗi truy xuất",
  members: "Thành viên",
  qrLabels: "Tem QR trong kỳ",
};

/** Label lookup that falls back to the raw code. */
export const label = (map: Record<string, string>, value: unknown) =>
  map[String(value)] ?? text(value);
