import type { ProofStatus, Role } from "./types";

const stateLabels: Record<string, string> = {
  CREATED: "Mới tạo",
  PLANTED: "Đang trồng",
  HARVESTED: "Đã thu hoạch",
  IN_TRANSPORT: "Đang vận chuyển",
  RETAIL_RECEIVED: "Cửa hàng đã nhận",
  FOR_SALE: "Đang bán",
  CANCELLED: "Đã hủy",
  DAMAGED: "Bị hỏng",
  REJECTED: "Bị từ chối",
  verified: "Đã xác minh",
  pending: "Chờ xác minh",
  mismatch: "Lệch bằng chứng",
  unavailable: "Chưa có bằng chứng"
};

const eventLabels: Record<string, string> = {
  BATCH_CREATED: "Khởi tạo lô",
  PLANTING_RECORDED: "Ghi nhận gieo trồng",
  CARE_RECORDED: "Ghi nhận chăm sóc",
  SENSOR_RECORDED: "Ghi nhận cảm biến",
  HARVEST_RECORDED: "Ghi nhận thu hoạch",
  SHIPMENT_CREATED: "Tạo chuyến vận chuyển",
  TRANSPORT_STARTED: "Bắt đầu vận chuyển",
  TRANSPORT_COMPLETED: "Hoàn tất vận chuyển",
  RETAIL_RECEIVED: "Cửa hàng nhận lô",
  RETAIL_REJECTED: "Cửa hàng từ chối",
  MARKED_FOR_SALE: "Đưa lên kệ bán"
};

const roleLabels: Record<Role, string> = {
  SYSTEM_ADMIN: "Quản trị hệ thống",
  FARM_STAFF: "Nhân viên trang trại",
  IOT_DEVICE: "Thiết bị cảm biến",
  TRANSPORTER: "Đơn vị vận chuyển",
  RETAILER: "Nhà bán lẻ",
  AUDITOR: "Kiểm tra viên",
  CONSUMER: "Người tiêu dùng"
};

const proofLabels: Record<ProofStatus, string> = {
  verified: "Đã khớp bằng chứng",
  pending: "Đang chờ ghi nhận",
  mismatch: "Dữ liệu không khớp",
  unavailable: "Chưa có dữ liệu"
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
