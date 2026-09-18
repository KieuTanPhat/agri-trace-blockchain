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
  BLOCKCHAIN_UNAVAILABLE: "Blockchain tạm không khả dụng"
};

const eventLabels: Record<string, string> = {
  PRODUCTION_CYCLE_CREATED: "Khởi tạo vụ trồng",
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
  LOT_EXPIRED: "Lô hết hạn"
};

const roleLabels: Record<Role, string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  FARM_STAFF: "Nhân viên trang trại",
  IOT_DEVICE: "Thiết bị cảm biến",
  TRANSPORTER: "Đơn vị vận chuyển",
  RETAILER: "Nhà bán lẻ",
  AUDITOR: "Kiểm tra viên",
  SYSTEM_ACTOR: "Tác vụ hệ thống"
};

const proofLabels: Record<ProofStatus, string> = {
  VERIFIED: "Đã khớp bằng chứng",
  PENDING: "Đang chờ ghi nhận",
  INTEGRITY_WARNING: "Dữ liệu không khớp",
  BLOCKCHAIN_UNAVAILABLE: "Không truy vấn được blockchain"
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
