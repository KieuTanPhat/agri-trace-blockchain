
const eventLabels: Record<string, string> = {
  PRODUCTION_CYCLE_CREATED: "Khởi tạo vụ trồng",
  CYCLE_PLANTED: "Ghi nhận gieo trồng",
  CYCLE_COMPLETED: "Kết thúc vụ trồng",
  CYCLE_CANCELLED: "Hủy vụ trồng",
  DISTRIBUTION_QUANTITY_RECORDED: "Ghi nhận số lượng / chế biến",
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

export function labelForEvent(eventType: string) {
  return eventLabels[eventType] ?? eventType;
}

