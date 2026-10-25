import type { PublicLot } from "../api/trace";

const states: Record<string, string> = {
  CONSUMED: "Đã dùng làm nguyên liệu chế biến",
  HARVESTED: "Đã thu hoạch",
  IN_TRANSPORT: "Đang vận chuyển",
  ARRIVED: "Đã đến nơi",
  RETAIL_RECEIVED: "Cửa hàng đã nhận",
  FOR_SALE: "Đang bày bán",
  SOLD: "Đã bán",
  RECALLED: "Đã thu hồi",
  EXPIRED: "Đã hết hạn",
  DAMAGED: "Hàng hư hỏng",
  REJECTED: "Đã từ chối nhận",
};
export const stateLabel = (state: string) =>
  states[state] ?? "Chưa có trạng thái";
export const formatDate = (value: string | null | undefined) => {
  if (!value || !Number.isFinite(Date.parse(value))) return "Chưa ghi nhận";
  return new Date(value).toLocaleDateString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
};

export type TraceWarning = {
  key: string;
  message: string;
  danger: boolean;
};

type WarningContent = Omit<TraceWarning, "key">;

const WARNING_CONTENT = new Map<string, WarningContent>([
  [
    "RECALLED",
    {
      message:
        "Lô hàng đã bị thu hồi. Không sử dụng; liên hệ nơi bán để được hướng dẫn.",
      danger: true,
    },
  ],
  [
    "EXPIRED",
    {
      message: "Lô hàng đã hết hạn sử dụng.",
      danger: true,
    },
  ],
  [
    "DAMAGED",
    {
      message: "Lô hàng được ghi nhận hư hỏng.",
      danger: true,
    },
  ],
  [
    "REJECTED",
    {
      message: "Lô hàng đã bị từ chối nhận.",
      danger: true,
    },
  ],
  [
    "INTEGRITY_WARNING",
    {
      message:
        "Thông tin đang cần đối soát. Vui lòng liên hệ đơn vị cung cấp trước khi sử dụng.",
      danger: true,
    },
  ],
  [
    "SENSOR_INTEGRITY_WARNING",
    {
      message: "Dữ liệu cảm biến đang cần được đối soát.",
      danger: false,
    },
  ],
  [
    "NO_DATA",
    {
      message: "Không có dữ liệu cảm biến cho lần thu hoạch này.",
      danger: false,
    },
  ],
  [
    "LATE_READINGS",
    {
      message:
        "Có dữ liệu cảm biến đến muộn, không được gộp vào cửa sổ thu hoạch đã chốt.",
      danger: false,
    },
  ],
  [
    "ADDITIONAL_WARNING",
    {
      message:
        "Lô hàng có cảnh báo bổ sung. Vui lòng liên hệ đơn vị cung cấp để kiểm tra.",
      danger: false,
    },
  ],
]);

function normalizeWarningCode(code: string): string {
  switch (code) {
    case "QUANTITY_MISMATCH":
    case "STATE_MISMATCH":
      return "INTEGRITY_WARNING";

    case "LEGACY_UNVERIFIED":
      return "SENSOR_INTEGRITY_WARNING";

    default:
      return WARNING_CONTENT.has(code) ? code : "ADDITIONAL_WARNING";
  }
}

export function traceWarningItems(lot: PublicLot): TraceWarning[] {
  const codes = new Set(
    lot.warnings.map((code) => normalizeWarningCode(code.trim())),
  );

  if (lot.currentState === "RECALLED") codes.add("RECALLED");

  if (lot.isExpired || lot.currentState === "EXPIRED") {
    codes.add("EXPIRED");
  }

  if (lot.currentState === "DAMAGED") codes.add("DAMAGED");
  if (lot.currentState === "REJECTED") codes.add("REJECTED");

  if (
    !lot.quantityReconciled ||
    !lot.stateReconciled ||
    lot.proofStatus === "INTEGRITY_WARNING"
  ) {
    codes.add("INTEGRITY_WARNING");
  }

  if (lot.sensorEvidence.status === "NO_DATA") {
    codes.add("NO_DATA");
  }

  if (lot.sensorEvidence.status === "INTEGRITY_WARNING") {
    codes.add("SENSOR_INTEGRITY_WARNING");
  }

  if (lot.sensorEvidence.lateReadingCount > 0) {
    codes.add("LATE_READINGS");
  }

  return [
    ...[...WARNING_CONTENT.entries()]
      .filter(([key]) => codes.has(key))
      .map(([key, content]) => ({ key, ...content })),
    ...(lot.notices ?? []).map((notice, index) => ({
      key: `notice-${index}`,
      message: notice.message,
      danger: notice.kind === "RECALL",
    })),
    ...(lot.productionWarnings ?? []).map((message, index) => ({
      key: `production-${index}`,
      message,
      danger: false,
    })),
  ];
}

export function traceWarnings(lot: PublicLot): string[] {
  return traceWarningItems(lot).map((warning) => warning.message);
}
