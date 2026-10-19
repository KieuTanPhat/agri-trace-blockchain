import { labels as workspaceLabels } from "@/lib/status-labels";

const statusLabels: Record<string, string> = {
  ...workspaceLabels,
  ACTIVE: "Đang hoạt động",
  INACTIVE: "Ngừng hoạt động",
  LOCKED: "Đã khóa",
  APPROVED: "Đã duyệt",
  REJECTED: "Đã từ chối",
  PENDING_REVIEW: "Chờ xét duyệt",
  CONNECTED: "Đã kết nối",
  CHECKING: "Đang kiểm tra",
  UNKNOWN: "Đang đối soát",
  FAILED: "Cần xử lý",
  REVOKED: "Đã thu hồi",
  WITHDRAWN: "Doanh nghiệp đã rút",
};
const pending = new Set([
  "PENDING_REVIEW",
  "CHECKING",
  "UNKNOWN",
  "INVITED",
  "PROPOSED",
  "READY",
]);
const blocked = new Set([
  "REJECTED",
  "LOCKED",
  "REVOKED",
  "FAILED",
  "CANCELLED",
]);
const active = new Set(["ACTIVE", "APPROVED", "CONNECTED"]);

export function statusTone(value: string) {
  return pending.has(value)
    ? "pending"
    : blocked.has(value)
      ? "blocked"
      : active.has(value)
        ? "active"
        : "neutral";
}

export function statusLabel(value: string) {
  return statusLabels[value] ?? value;
}

/** Lifecycle status shown with one label and tone across management pages. */
export function StatusBadge({
  value,
  label,
}: {
  value: string;
  /** Overrides the shared label when a page needs a domain wording. */
  label?: string;
}) {
  return (
    <span className={`manage-status manage-status--${statusTone(value)}`}>
      {label ?? statusLabel(value)}
    </span>
  );
}
