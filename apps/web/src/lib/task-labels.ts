/** Fired after a notification is read so the top-bar bell refreshes. */
export const NOTIFICATIONS_CHANGED_EVENT = "agritrace:notifications-changed";

/** Wording for work waiting on an organization (inbox and notifications). */
export const transferActions: Record<string, string> = {
  CONSENT: "Ký đồng thuận kế hoạch giao",
  PICKUP: "Ký lấy hàng",
  DELIVERY: "Ký giao / nhận hàng",
  ACTUAL_RECEIPT: "Lập biên bản thực nhận",
  SIGN_RETURN: "Ký bàn giao trả hàng",
  RECONCILE_REMAINDER: "Đối soát phần hàng chưa được nhận",
};
export const stockKinds: Record<string, string> = {
  RECALL: "Lô bị thu hồi: dừng bán/giao và xử lý phần đang giữ",
  EXPIRED: "Đã hết hạn theo ngày Việt Nam: dừng bán",
  EXPIRING: "Sắp hết hạn trong 7 ngày",
  QUARANTINED: "Đang cách ly tại cơ sở",
};
