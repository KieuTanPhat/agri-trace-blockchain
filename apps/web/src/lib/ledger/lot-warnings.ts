/** Readable lot warnings for enterprise screens. A cycle without a sensor is
 * allowed (IoT is optional), so NO_DATA is information, not a warning. */
export const LOT_WARNING: Record<string, { label: string; tone: "info" | "warn" | "danger" }> = {
  RECALLED: { label: "Lô đang bị thu hồi", tone: "danger" },
  DAMAGED: { label: "Lô bị hư hỏng", tone: "warn" },
  REJECTED: { label: "Lô bị từ chối nhận", tone: "warn" },
  NO_DATA: { label: "Vụ không gắn cảm biến; lô không có dữ liệu nhiệt độ, độ ẩm (không bắt buộc)", tone: "info" },
  SENSOR_INTEGRITY_WARNING: { label: "Dữ liệu cảm biến của lô có điểm bất thường", tone: "warn" },
  LATE_READINGS: { label: "Một số số đo cảm biến được gửi muộn", tone: "info" },
};

/** Codes the lot screen already shows in its own expiry or reconciliation notice. */
export const LOT_WARNING_SHOWN_ELSEWHERE = new Set(["EXPIRED", "QUANTITY_MISMATCH", "STATE_MISMATCH"]);
