import type { LotTrace } from "@/lib/types";

export function LotWarnings({
  lot,
}: {
  lot: Pick<LotTrace, "warnings" | "sensorEvidence" | "expiryDate">;
}) {
  const labels: Record<string, string> = {
    RECALLED: "Lô hàng đã được thu hồi. Liên hệ điểm bán để xử lý.",
    EXPIRED: `Lô đã quá hạn sử dụng${lot.expiryDate ? ` (${lot.expiryDate})` : ""}.`,
    DAMAGED: "Toàn bộ lượng hàng còn lại đã được ghi nhận hư hỏng.",
    REJECTED: "Điểm bán đã từ chối nhận lô hàng.",
    QUANTITY_MISMATCH: "Thông tin lượng hàng cần được đối soát.",
    STATE_MISMATCH: "Thông tin giao nhận cần được đối soát.",
    NO_DATA:
      "Lần thu hoạch này không có dữ liệu cảm biến trong khoảng đã chốt.",
    LEGACY_UNVERIFIED:
      "Chưa xác minh đầy đủ dữ liệu cảm biến của lần thu hoạch này.",
    SENSOR_INTEGRITY_WARNING:
      "Dữ liệu cảm biến chưa khớp với bằng chứng đã chốt.",
    LATE_READINGS: `Có ${lot.sensorEvidence.lateReadingCount} mẫu cảm biến đến sau khi đã chốt; các mẫu này được giữ riêng để đối soát.`,
  };
  const warnings = lot.warnings.filter((code) => labels[code]);
  if (!warnings.length) return null;
  return (
    <section
      className="notice error"
      role="alert"
      aria-label="Cảnh báo lô hàng"
    >
      <h2>Cảnh báo lô hàng</h2>
      <ul>
        {warnings.map((code) => (
          <li key={code}>{labels[code]}</li>
        ))}
      </ul>
    </section>
  );
}
