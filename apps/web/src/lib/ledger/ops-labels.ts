import { localized } from "@/lib/ledger/i18n";
import type { Tone } from "@/lib/ledger/labels";

export const CYCLE_STATE_LABEL: Record<string, string> = localized({
  CREATED: "Đã lập kế hoạch",
  PLANTED: "Đã xuống giống",
  GROWING: "Đang chăm sóc",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
});
export const CYCLE_STATE_TONE: Record<string, Tone> = { CREATED: "info", PLANTED: "brand", GROWING: "ok", COMPLETED: "neutral", CANCELLED: "danger" };

export const LOT_STATE_LABEL: Record<string, string> = localized({
  HARVESTED: "Tại nơi sản xuất",
  IN_TRANSPORT: "Đang vận chuyển",
  ARRIVED: "Đã đến nơi nhận",
  RETAIL_RECEIVED: "Bán lẻ đã nhận",
  FOR_SALE: "Đang bày bán",
  SOLD: "Đã bán",
  RECALLED: "Đã thu hồi",
  EXPIRED: "Hết hạn",
  DAMAGED: "Hư hỏng",
  REJECTED: "Bị từ chối nhận",
  AVAILABLE: "Sẵn có",
  IN_DISTRIBUTION: "Đang phân phối",
  CONSUMED: "Đã chế biến hết",
});
export const LOT_STATE_TONE: Record<string, Tone> = { HARVESTED: "info", IN_TRANSPORT: "brand", ARRIVED: "brand", RETAIL_RECEIVED: "ok", FOR_SALE: "ok", SOLD: "neutral", RECALLED: "danger", EXPIRED: "warn", DAMAGED: "danger", REJECTED: "warn" };

export const SHIPMENT_STATUS_LABEL: Record<string, string> = localized({
  CREATED: "Chờ lấy hàng",
  IN_TRANSIT: "Đang vận chuyển",
  ARRIVED: "Đã đến",
  DELIVERED: "Đã giao",
  REJECTED: "Bị từ chối",
  FAILED: "Thất bại",
});
export const SHIPMENT_STATUS_TONE: Record<string, Tone> = { CREATED: "info", IN_TRANSIT: "brand", ARRIVED: "brand", DELIVERED: "ok", REJECTED: "warn", FAILED: "danger" };

export const MOVEMENT_LABEL: Record<string, string> = localized({
  HARVEST_IN: "Nhập từ thu hoạch",
  DAMAGE_OUT: "Hư hỏng",
  SALE_OUT: "Bán",
  RECALL_OUT: "Thu hồi",
  EXPIRE_OUT: "Hết hạn",
  PROCESSING_OUT: "Xuất cho chế biến",
  PROCESSING_IN: "Nhập từ chế biến",
});

export const ROLE_LABEL_BUSINESS: Record<string, string> = localized({ FARM_STAFF: "Sản xuất", TRANSPORTER: "Vận chuyển", RETAILER: "Bán lẻ" });

/** Loại công việc chăm sóc — Backend lưu chuỗi tự do (≤ 100 ký tự); đây là danh sách gợi ý. */
export const CARE_TYPES = ["Tưới nước", "Bón phân", "Phun thuốc", "Làm cỏ", "Theo dõi sâu bệnh", "Khác"];
export const CARE_TYPE_LABEL: Record<string, string> = localized(Object.fromEntries(CARE_TYPES.map((t) => [t, t])));
