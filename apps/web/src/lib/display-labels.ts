import type { ProofStatus, Role } from "./types";

const stateLabels: Record<string, string> = {
  CREATED: "Mới tạo",
  PLANTED: "Đang trồng",
  GROWING: "Đang sinh trưởng",
  COMPLETED: "Đã kết thúc vụ",
  HARVESTED: "Đã thu hoạch",
  IN_TRANSPORT: "Đang vận chuyển",
  ARRIVED: "Đã đến điểm nhận",
  RETAIL_RECEIVED: "Cửa hàng đã nhận",
  FOR_SALE: "Đang bán",
  SOLD: "Đã bán",
  RECALLED: "Đã thu hồi",
  EXPIRED: "Đã hết hạn",
  CANCELLED: "Đã hủy",
  DAMAGED: "Bị hỏng",
  REJECTED: "Bị từ chối",
  VERIFIED: "Đã xác minh",
  PENDING: "Chờ xác minh",
  INTEGRITY_WARNING: "Cảnh báo toàn vẹn",
  BLOCKCHAIN_UNAVAILABLE: "Blockchain tạm không khả dụng",
};

const eventLabels: Record<string, string> = {
  PRODUCTION_CYCLE_CREATED: "Khởi tạo vụ trồng",
  CYCLE_PLANTED: "Ghi nhận gieo trồng",
  CYCLE_COMPLETED: "Kết thúc vụ trồng",
  CYCLE_CANCELLED: "Hủy vụ trồng",
  SENSOR_READING_RECORDED: "Ghi nhận cảm biến",
  SENSOR_DIGEST_CREATED: "Tổng hợp dữ liệu cảm biến",
  SENSOR_DIGEST_FINALIZED: "Chốt dữ liệu cảm biến cuối kỳ",
  SHIPMENT_STARTED: "Bắt đầu vận chuyển",
  SHIPMENT_ARRIVED: "Đến điểm nhận",
  SHIPMENT_RECEIVED: "Cửa hàng nhận lô",
  SHIPMENT_REJECTED: "Cửa hàng từ chối",
  SHIPMENT_DAMAGE_RECORDED: "Ghi nhận hàng hư hỏng",
  SHIPMENT_TELEMETRY_DIGEST_CREATED: "Tổng hợp dữ liệu vận chuyển",
  SHIPMENT_TELEMETRY_DIGEST_FINALIZED: "Chốt dữ liệu vận chuyển",
  TRACKING_DEVICE_BOUND: "Gắn thiết bị theo dõi",
  TRACKING_DEVICE_UNBOUND: "Ngừng theo dõi thiết bị",
  INSPECTION_RECORDED: "Ghi nhận kết quả kiểm tra",
  CERTIFICATE_SUBMITTED: "Gửi chứng chỉ xét duyệt",
  CERTIFICATE_APPROVED: "Phê duyệt chứng chỉ",
  CERTIFICATE_REJECTED: "Từ chối chứng chỉ",
  PLANTING_RECORDED: "Ghi nhận gieo trồng",
  CARE_RECORDED: "Ghi nhận chăm sóc",
  SENSOR_RECORDED: "Ghi nhận cảm biến",
  HARVEST_RECORDED: "Ghi nhận thu hoạch",
  SHIPMENT_CREATED: "Tạo chuyến vận chuyển",
  TRANSPORT_STARTED: "Bắt đầu vận chuyển",
  TRANSPORT_ARRIVED: "Đến điểm nhận",
  RETAIL_RECEIVED: "Cửa hàng nhận lô",
  RETAIL_REJECTED: "Cửa hàng từ chối",
  MARKED_FOR_SALE: "Đưa lên kệ bán",
  LOT_SOLD: "Đã bán",
  RECALL_RECORDED: "Thu hồi lô",
  LOT_EXPIRED: "Lô hết hạn",
};

const roleLabels: Record<Role, string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  FARM_STAFF: "Nhân viên trang trại",
  IOT_DEVICE: "Thiết bị cảm biến",
  TRANSPORTER: "Đơn vị vận chuyển",
  RETAILER: "Nhà bán lẻ",
  AUDITOR: "Kiểm tra viên",
  COMPLIANCE_REVIEWER: "Người duyệt tuân thủ",
  SYSTEM_ACTOR: "Tác vụ hệ thống",
};

const proofLabels: Record<ProofStatus, string> = {
  VERIFIED: "Đã khớp bằng chứng",
  PENDING: "Đang chờ ghi nhận",
  INTEGRITY_WARNING: "Dữ liệu không khớp",
  BLOCKCHAIN_UNAVAILABLE: "Không truy vấn được blockchain",
};

export function labelForState(state: string) {
  return stateLabels[state] ?? state;
}

export function labelForEvent(eventType: string) {
  return eventLabels[eventType] ?? eventType;
}

export function labelForRole(role: Role) {
  return roleLabels[role] ?? role;
}

export function labelForProof(status: ProofStatus) {
  return proofLabels[status] ?? status;
}
