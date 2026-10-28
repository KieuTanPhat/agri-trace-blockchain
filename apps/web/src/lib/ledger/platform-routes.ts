import type { InboxItem, InboxKind } from "./platform-api";
import { t } from "./i18n";

/** Display guidance only. The API supplies deadlines and the canonical action URL. */
export function getInboxGuide(kind: InboxKind) {
  const guides: Record<InboxKind, { who: string; rule: string }> = {
    ENROLLMENT: {
      who: "Quản trị viên nền tảng",
      rule: "Đối chiếu hồ sơ và tài liệu trước khi ghi quyết định. Phê duyệt hồ sơ và kích hoạt dịch vụ là hai bước riêng.",
    },
    CAPABILITY: {
      who: "Quản trị viên nền tảng",
      rule: "Kiểm tra thông tin năng lực, chứng từ và phiên bản yêu cầu hiện tại.",
    },
    AMENDMENT: {
      who: "Quản trị viên nền tảng",
      rule: "So sánh thay đổi với hồ sơ hiện hành và xem bằng chứng trước khi quyết định.",
    },
    CONNECTION: {
      who: "Quản trị viên nền tảng",
      rule: "Đối chiếu chuỗi, tổ chức và phạm vi kết nối được đề nghị.",
    },
    TICKET: {
      who: "Người phụ trách hỗ trợ",
      rule: "Xem nội dung, lịch sử và phạm vi truy cập trước khi phản hồi hoặc chuyển trạng thái.",
    },
    CONSUMER_REPORT: {
      who: "Người phụ trách hỗ trợ",
      rule: "Xem thông tin phản ánh và bằng chứng được phép truy cập trước khi xử lý.",
    },
    CASE: {
      who: "Người phụ trách vụ việc",
      rule: "Đối chiếu bằng chứng và các bước xử lý của vụ việc.",
    },
    INVOICE_OVERDUE: {
      who: "Quản trị viên nền tảng",
      rule: "Kiểm tra hóa đơn và khoản thanh toán. Chỉ ghi nhận giao dịch theo quyền và quy trình hiện hành.",
    },
  };
  return {
    sla: t("Theo hạn xử lý hiển thị trên mục việc"),
    who: t(guides[kind].who),
    rule: t(guides[kind].rule),
  };
}
export function inboxHref(item: InboxItem) {
  return item.href.startsWith("/admin/") && !item.href.includes("\\")
    ? item.href
    : "/admin/inbox";
}
