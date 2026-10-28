import {
  caseCategoryLabels,
  caseSeverityLabels,
  caseStatusLabels,
  type EnterpriseCase,
} from "./platform-governance";
import { stockKinds, transferActions } from "./task-labels";
import type { Row } from "./workspace";

export type InboxKind = "transfer" | "case" | "stock" | "ownership";
export type InboxItem = {
  key: string;
  kind: InboxKind;
  title: string;
  description: string;
  reference: string;
  status: string;
  statusLabel: string;
  priority: string;
  overdue: boolean;
  closed: boolean;
  metadata: [string, string][];
  details: [string, string][];
  href?: string;
  linkLabel?: string;
  relatedHref?: string;
  relatedLabel?: string;
  caseRecord?: EnterpriseCase;
};
export type InboxTasks = {
  transfers: Row[];
  stock: Row[];
  counts: Record<string, number>;
};
export const inboxKindLabels: Record<InboxKind, string> = {
  transfer: "Giao nhận chờ bạn",
  case: "Yêu cầu từ nền tảng",
  stock: "Lô cần xử lý",
  ownership: "Chuyển quyền chủ quản",
};
const transferStatuses: Record<string, string> = {
  PROPOSED: "Chờ đồng thuận",
  READY: "Sẵn sàng lấy hàng",
  IN_TRANSIT: "Đang vận chuyển",
  DELIVERED: "Đã giao hàng",
};
const transferRoles: Record<string, string> = {
  SENDER: "Bên giao hàng",
  CARRIER: "Bên vận chuyển",
  RECEIVER: "Bên nhận hàng",
};
const transferDescriptions: Record<string, string> = {
  CONSENT:
    "Kiểm tra kế hoạch, lượng hàng và các bên tham gia trước khi ký đồng thuận.",
  PICKUP: "Kiểm tra chặng giao nhận và ký xác nhận lấy hàng.",
  DELIVERY: "Kiểm tra thông tin giao hàng và thực nhận trước khi ký.",
  ACTUAL_RECEIPT: "Ghi nhận lượng thực nhận, từ chối và cách ly của từng lô.",
  SIGN_RETURN: "Kiểm tra hàng trả và ký xác nhận bàn giao trả hàng.",
  RECONCILE_REMAINDER: "Đối soát phần hàng chưa được bên nhận xác nhận.",
};
const stockStatuses: Record<string, string> = {
  RECALL: "Bị thu hồi",
  EXPIRED: "Đã hết hạn",
  EXPIRING: "Sắp hết hạn",
  QUARANTINED: "Đang cách ly",
};
const value = (input: unknown) =>
  typeof input === "string" || typeof input === "number" ? String(input) : "";
const person = (input: unknown) =>
  value(input && typeof input === "object" ? (input as Row).fullName : "");
export function inboxDate(input: unknown) {
  if (!input) return "";
  const date = new Date(String(input));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
}
function caseUpdated(record: EnterpriseCase) {
  return record.events.reduce(
    (latest, event) =>
      new Date(event.createdAt) > new Date(latest) ? event.createdAt : latest,
    record.createdAt,
  );
}

/** Only records returned by scoped queries are represented here. */
export function buildInboxItems({
  tasks,
  ownership,
  memberId,
  cases,
}: {
  tasks: InboxTasks | null;
  ownership: Row[];
  memberId?: string;
  cases: EnterpriseCase[];
}): InboxItem[] {
  const transfers: InboxItem[] = (tasks?.transfers ?? []).map((row, index) => {
    const id = value(row.transferId),
      action = value(row.action),
      role = transferRoles[value(row.role)] ?? value(row.role),
      status = transferStatuses[value(row.status)] ?? value(row.status);
    const route = [value(row.origin), value(row.destination)]
      .filter(Boolean)
      .join(" → ");
    return {
      key: `transfer:${id}:${action}:${index}`,
      kind: "transfer",
      title: transferActions[action] ?? action,
      description: transferDescriptions[action] ?? route,
      reference: id,
      status: `transfer:${value(row.status)}`,
      statusLabel: status,
      priority: "NONE",
      overdue: false,
      closed: false,
      metadata: [
        ["Mã giao nhận", id],
        ["Vai trò doanh nghiệp", role],
        ["Tuyến giao nhận", route],
      ],
      details: [
        ["Mã giao nhận", id],
        ["Việc cần thực hiện", transferActions[action] ?? action],
        ["Trạng thái chặng", status],
        ["Vai trò doanh nghiệp", role],
        ["Điểm đi", value(row.origin)],
        ["Điểm đến", value(row.destination)],
        ["Ngày tạo", inboxDate(row.createdAt)],
      ],
      href: id ? `/distribution/${encodeURIComponent(id)}` : undefined,
      linkLabel: "Mở giao nhận",
    };
  });
  const platformCases: InboxItem[] = cases.map((row) => ({
    key: `case:${row.id}`,
    kind: "case",
    title: row.title,
    description: row.description,
    reference: `#${row.caseNumber}`,
    status: `case:${row.status}`,
    statusLabel: caseStatusLabels[row.status] ?? row.status,
    priority: row.severity,
    overdue: row.status !== "CLOSED" && row.overdue,
    closed: row.status === "CLOSED",
    metadata: [
      [
        "Mã hồ sơ / lô",
        `#${row.caseNumber}${row.lot ? ` · ${row.lot.lotCode}` : ""}`,
      ],
      [
        "Người gửi / Phân loại",
        `Nền tảng · ${caseCategoryLabels[row.category] ?? row.category} · Ưu tiên ${caseSeverityLabels[row.severity] ?? row.severity}`,
      ],
      ["Cập nhật gần nhất", inboxDate(caseUpdated(row))],
    ],
    details: [
      ["Mã hồ sơ", `#${row.caseNumber}`],
      ["Người gửi", "Nền tảng"],
      ["Trạng thái", caseStatusLabels[row.status] ?? row.status],
      ["Mức ưu tiên", caseSeverityLabels[row.severity] ?? row.severity],
      ["Phân loại", caseCategoryLabels[row.category] ?? row.category],
      ["Lô liên quan", row.lot?.lotCode ?? ""],
      ["Hạn phản hồi", inboxDate(row.responseDueAt)],
      ["Ngày tạo", inboxDate(row.createdAt)],
      ["Cập nhật gần nhất", inboxDate(caseUpdated(row))],
    ],
    relatedHref: row.lot
      ? `/lots/${encodeURIComponent(row.lot.id)}`
      : undefined,
    relatedLabel: "Mở hồ sơ lô",
    caseRecord: row,
  }));
  const stock: InboxItem[] = (tasks?.stock ?? []).map((row) => {
    const id = value(row.lotId),
      code = value(row.lotCode),
      kind = value(row.kind),
      unit = value(row.unit);
    return {
      key: `stock:${id}:${kind}`,
      kind: "stock",
      title: `${code} · ${value(row.productName)}`,
      description: stockKinds[kind] ?? kind,
      reference: code,
      status: `stock:${kind}`,
      statusLabel: stockStatuses[kind] ?? kind,
      priority: "NONE",
      overdue: false,
      closed: false,
      metadata: [
        ["Mã lô", code],
        ["Lượng đang giữ", `${value(row.held)} ${unit}`],
        ["Hạn sử dụng", inboxDate(row.expiryDate) || "Chưa ghi nhận"],
      ],
      details: [
        ["Mã lô", code],
        ["Nông sản", value(row.productName)],
        ["Tình trạng", stockKinds[kind] ?? kind],
        ["Lượng đang giữ", `${value(row.held)} ${unit}`],
        ["Lượng cách ly", `${value(row.quarantined)} ${unit}`],
        ["Hạn sử dụng", inboxDate(row.expiryDate)],
      ],
      href: "/enterprise/inventory",
      linkLabel: "Mở tồn và cách ly",
      relatedHref: id ? `/lots/${encodeURIComponent(id)}` : undefined,
      relatedLabel: "Mở hồ sơ lô",
    };
  });
  const incoming: InboxItem[] = ownership
    .filter(
      (row) =>
        row.status === "PENDING" &&
        !row.expired &&
        !!memberId &&
        (row.to as Row | null)?.id === memberId,
    )
    .map((row) => ({
      key: `ownership:${value(row.id)}`,
      kind: "ownership",
      title: "Yêu cầu chuyển quyền chủ quản",
      description: value(row.reason),
      reference: value(row.id),
      status: "ownership:PENDING",
      statusLabel: "Chờ bạn phản hồi",
      priority: "NONE",
      overdue: false,
      closed: false,
      metadata: [
        ["Người đề nghị", person(row.from)],
        ["Người nhận", person(row.to)],
        ["Hạn phản hồi", inboxDate(row.expiresAt)],
      ],
      details: [
        ["Mã yêu cầu", value(row.id)],
        ["Người đề nghị", person(row.from)],
        ["Người nhận", person(row.to)],
        ["Trạng thái", "Chờ bạn phản hồi"],
        ["Hạn phản hồi", inboxDate(row.expiresAt)],
        ["Ngày tạo", inboxDate(row.createdAt)],
        [
          "Sau khi chuyển",
          row.retainPreviousAdmin
            ? "Người chuyển giữ quyền quản trị cấp 1"
            : "Người chuyển bỏ quyền quản trị cấp 1",
        ],
      ],
      href: "/enterprise/ownership",
      linkLabel: "Mở yêu cầu và phản hồi",
    }));
  return [...transfers, ...platformCases, ...stock, ...incoming];
}
export function searchInbox(item: InboxItem, search: string) {
  const normalize = (text: string) =>
    text
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/đ/g, "d");
  return normalize(
    [
      item.title,
      item.description,
      item.reference,
      ...item.metadata.flat(),
    ].join(" "),
  ).includes(normalize(search.trim()));
}
