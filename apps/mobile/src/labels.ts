import type { components } from "./api/generated/api";

type PublicLot = components["schemas"]["PublicLotDto"];
export type ProofStatus = PublicLot["proofStatus"];
export type LotState = PublicLot["currentState"];
export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

// Same wording as apps/web/src/lib/display-labels.ts so Web and the app speak one language.
const LOT_STATES: Record<LotState, { label: string; tone: Tone }> = {
  HARVESTED: { label: "Đã thu hoạch", tone: "success" },
  IN_TRANSPORT: { label: "Đang vận chuyển", tone: "info" },
  ARRIVED: { label: "Đã đến điểm nhận", tone: "info" },
  RETAIL_RECEIVED: { label: "Cửa hàng đã nhận", tone: "success" },
  FOR_SALE: { label: "Đang bán", tone: "success" },
  SOLD: { label: "Đã bán", tone: "neutral" },
  RECALLED: { label: "Đã thu hồi", tone: "danger" },
  EXPIRED: { label: "Đã hết hạn", tone: "danger" },
  DAMAGED: { label: "Bị hỏng", tone: "danger" },
  REJECTED: { label: "Bị từ chối", tone: "danger" },
};

export function lotState(state: LotState): { label: string; tone: Tone } {
  return LOT_STATES[state] ?? { label: state, tone: "neutral" };
}

/**
 * VERIFIED means the record matches its anchored evidence. It is not a statement
 * about product quality or an independent certification.
 */
const PROOF: Record<ProofStatus, { label: string; description: string; tone: Tone }> = {
  VERIFIED: {
    label: "Đã khớp bằng chứng",
    description: "Dữ liệu trùng khớp với bằng chứng đã neo trên blockchain.",
    tone: "success",
  },
  PENDING: {
    label: "Đang chờ ghi nhận",
    description: "Đã ghi nhận, đang chờ xác nhận trên blockchain.",
    tone: "warning",
  },
  INTEGRITY_WARNING: {
    label: "Dữ liệu không khớp",
    description: "Bản ghi khác với bằng chứng đã neo. Dữ liệu cần được đối soát.",
    tone: "danger",
  },
  BLOCKCHAIN_UNAVAILABLE: {
    label: "Không truy vấn được blockchain",
    description: "Chưa đối chiếu được với sổ cái. Dữ liệu hiển thị chưa được kiểm tra.",
    tone: "neutral",
  },
};

export function proofStatus(status: ProofStatus) {
  return PROOF[status] ?? PROOF.BLOCKCHAIN_UNAVAILABLE;
}

export const VERIFIED_DISCLAIMER = "Xác minh dữ liệu không bị sửa — không thay thế chứng nhận chất lượng.";

/** Public warning codes, worded as in apps/web/src/components/lot-warnings.tsx. */
export function warningMessage(code: string, lot: Pick<PublicLot, "expiryDate" | "sensorEvidence">): string | null {
  switch (code) {
    case "RECALLED":
      return "Lô hàng đã được thu hồi. Liên hệ điểm bán để xử lý.";
    case "EXPIRED":
      return `Lô đã quá hạn sử dụng${lot.expiryDate ? ` (${formatDate(lot.expiryDate)})` : ""}.`;
    case "DAMAGED":
      return "Toàn bộ lượng hàng còn lại đã được ghi nhận hư hỏng.";
    case "REJECTED":
      return "Điểm bán đã từ chối nhận lô hàng.";
    case "QUANTITY_MISMATCH":
      return "Thông tin lượng hàng cần được đối soát.";
    case "STATE_MISMATCH":
      return "Thông tin giao nhận cần được đối soát.";
    case "NO_DATA":
      return "Lần thu hoạch này không có dữ liệu cảm biến trong khoảng đã chốt.";
    case "LEGACY_UNVERIFIED":
      return "Chưa xác minh đầy đủ dữ liệu cảm biến của lần thu hoạch này.";
    case "SENSOR_INTEGRITY_WARNING":
      return "Dữ liệu cảm biến chưa khớp với bằng chứng đã chốt.";
    case "LATE_READINGS":
      return `Có ${lot.sensorEvidence.lateReadingCount} mẫu cảm biến đến sau khi đã chốt; các mẫu này được giữ riêng để đối soát.`;
    default:
      return null;
  }
}

/** Vietnamese formats: 14/10/2026 and 14/10/2026 · 06:40 (24h, device time zone). */
export function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${formatDate(value)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatQuantity(value: number, unit: string): string {
  const [whole = "0", fraction] = String(value).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${fraction ? `${grouped},${fraction}` : grouped} ${unit}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
