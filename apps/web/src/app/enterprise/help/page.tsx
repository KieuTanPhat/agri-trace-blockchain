"use client";
import Link from "next/link";
import { useWorkspaceData, type Overview } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";
const tasks = [
 { capability: 'FARM', title: 'Sản xuất', steps: ['Tạo vùng, thửa và sản phẩm; mở vụ trên chuỗi đã được chấp thuận.', 'Ghi giống, vật tư và nhật ký theo ngày thực tế; bổ sung tài liệu chứng minh.', 'Thu hoạch tạo lô nguồn và cửa sổ cảm biến; kiểm tra lượng và hạn dùng.', 'Phân bổ lô vào cơ sở, mời đối tác và lập chặng giao.'], href: '/production-cycles' },
 { capability: 'TRANSPORTER', title: 'Vận chuyển', steps: ['Đối chiếu cơ sở, phương tiện, nguồn và lượng trong chặng.', 'Ký đồng thuận và lấy hàng bằng khóa trên thiết bị.', 'Ghi nhật ký quan sát; tách dữ liệu thủ công với cảm biến.', 'Đối chiếu biên bản thực nhận, ký giao; lượng từ chối hoặc thiếu còn chờ đối soát. Trả hàng chỉ hoàn tồn sau hai bên ký.'], href: '/distribution' },
 { capability: 'DISTRIBUTOR', title: 'Phân phối', steps: ['Nhận hàng theo thực tế tại đúng kho; ghi phần cách ly, từ chối và thiếu.', 'Theo dõi tồn, giữ chỗ và cách ly theo từng cơ sở.', 'Tạo chặng mới từ chính lô nguồn; tổng lượng không tăng khi đi qua nhiều bên.'], href: '/enterprise/reports' },
 { capability: 'RETAILER', title: 'Bán lẻ', steps: ['Đối chiếu nguồn và thực nhận tại cửa hàng.', 'Ghi lượng bán ra, hỏng hoặc hao hụt để đối soát truy xuất.', 'Kiểm tra cảnh báo và hạn dùng; dừng bán hàng thu hồi, hết hạn hoặc cách ly.', 'In QR dẫn đến lô nguồn; chữ ký và proof blockchain là các trạng thái riêng.'], href: '/enterprise/reports' },
] as const;
export default function HelpPage() {
 const state = useWorkspaceData<Overview>('/enterprise-workspace');
 return <div className="manage-console"><PageHeader actionKind="create" back="/enterprise" backLabel="Doanh nghiệp" title="Hướng dẫn công việc" description="Quy trình AgriTrace theo năng lực tổ chức và phạm vi được phân công." /><LoadState {...state} />
 {tasks.filter(t => state.data?.organization.capabilities.includes(t.capability)).map(t => <section className="panel" key={t.capability}><h2>{t.title}</h2><ol>{t.steps.map(s => <li key={s}>{s}</li>)}</ol><Link className="text-link" href={t.href}>Mở nghiệp vụ →</Link></section>)}
 <section className="panel"><h2>Thành viên và xử lý lỗi</h2><p>Cấp 1 quản trị tổ chức. Cấp 2 chỉ phân quyền trong phạm vi được giao cho cấp 3. Khóa thành viên hoặc thu hồi quyền có hiệu lực cả ở các bước ký tiếp theo.</p><p>Khi chưa rõ kết quả gửi, giữ nguyên yêu cầu cũ và mã đối soát. Dùng nút thử lại yêu cầu cũ hoặc kiểm tra trạng thái trước khi lập lệnh khác.</p><p>Admin tiếp nhận và điều phối sự cố tại hộp công việc. Quyết định giao nhận, lượng hàng và chữ ký thuộc doanh nghiệp.</p><Link className="text-link" href="/enterprise/inbox">Hộp công việc →</Link></section></div>;
}
