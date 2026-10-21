"use client";

import Link from "next/link";
import { DataTable, ManagePage, PageHeader, Section } from "@/components/manage";

const PLATFORM_ROLES = [
  { code: "SYSTEM_ADMIN", name: "Quản trị toàn nền tảng", scope: "Xét duyệt doanh nghiệp và năng lực, gói dịch vụ, cấu hình, phê duyệt hai bước, khóa QR, quản lý tài khoản.", limits: "Không ghi lô, vụ, giao nhận hay thu hồi thay doanh nghiệp. Thao tác nhạy cảm cần người thứ hai khi bật phê duyệt hai bước." },
  { code: "PLATFORM_OPERATOR", name: "Vận hành (chỉ đọc)", scope: "Giám sát vận hành, blockchain, dịch vụ, thống kê, tra cứu lô và diễn tập thu hồi.", limits: "Không có thao tác ghi; xử lý sự cố hạ tầng theo runbook của operator." },
  { code: "PLATFORM_CASE_MANAGER", name: "Điều phối sự cố & hỗ trợ", scope: "Hồ sơ sự cố, yêu cầu hỗ trợ, báo cáo vi phạm từ người tiêu dùng, hộp việc.", limits: "Không đổi custody, số lượng hay thu hồi lô." },
  { code: "PLATFORM_PRIVACY_OFFICER", name: "Phụ trách dữ liệu cá nhân", scope: "Hộp thư quyền dữ liệu cá nhân và sự cố lộ lọt.", limits: "Không xóa chứng cứ truy xuất từ một yêu cầu." },
  { code: "AUDITOR", name: "Kiểm toán", scope: "Đọc nhật ký kiểm toán, phê duyệt, vận hành, dịch vụ, thống kê, báo cáo truy xuất.", limits: "Không ghi." },
  { code: "COMPLIANCE_REVIEWER", name: "Kiểm định viên", scope: "Kết luận kiểm định trong phạm vi được phân công.", limits: "Độc lập với bên nộp; không tự đăng ký." },
];
const ENTERPRISE_TEMPLATES = [
  { capability: "Nhà sản xuất/HTX", roles: "Nhân viên sản xuất · Quản lý sản xuất" },
  { capability: "Vận chuyển", roles: "Nhân viên vận chuyển" },
  { capability: "Chế biến", roles: "Nhân viên chế biến · Quản đốc chế biến · Thủ kho nguyên liệu" },
  { capability: "Phân phối", roles: "Thủ kho phân phối" },
  { capability: "Bán lẻ", roles: "Nhân viên nhận hàng bán lẻ · Nhân viên bán lẻ và hao hụt" },
];

/** Read-only matrix. Platform roles are assigned to platform accounts; business
 * roles are managed by each organization's level-1 administrator. */
export default function RolesPage() {
  return (
    <ManagePage>
      <PageHeader
        title="Vai trò & phân quyền"
        description="Ma trận vai trò nền tảng và mẫu vai trò doanh nghiệp. Admin không sửa quyền nghiệp vụ của doanh nghiệp; quản trị cấp 1 của từng tổ chức tự phân quyền thành viên."
      />
      <Section title="Vai trò nền tảng" actions={<Link className="button secondary" href="/admin/users">Quản lý tài khoản</Link>}>
        <DataTable
          label="Vai trò nền tảng"
          rows={PLATFORM_ROLES}
          rowKey={(r) => r.code}
          columns={[
            { header: "Vai trò", cell: (r) => <strong>{r.name}</strong> },
            { header: "Phạm vi", cell: (r) => r.scope },
            { header: "Giới hạn", cell: (r) => r.limits },
          ]}
        />
      </Section>
      <Section title="Mẫu vai trò doanh nghiệp theo năng lực" help="Mẫu chỉ là gợi ý; phân công vẫn kiểm tra năng lực, chuỗi và cơ sở được giao.">
        <DataTable
          label="Mẫu vai trò doanh nghiệp"
          rows={ENTERPRISE_TEMPLATES}
          rowKey={(r) => r.capability}
          columns={[
            { header: "Năng lực", cell: (r) => r.capability },
            { header: "Mẫu vai trò", cell: (r) => r.roles },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
