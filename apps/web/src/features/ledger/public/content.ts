/**
 * Nội dung tĩnh của trang công khai (tiếng Việt là khóa dịch, xem public-i18n-en.ts).
 * Chỉ mô tả năng lực đã có trong hệ thống; không đặt số liệu, khách hàng hay giá chưa xác nhận.
 * Ảnh Unsplash ghi nguồn trong PHOTO_CREDITS; ảnh bìa và minh họa About tạo riêng cho trang; ảnh người tiêu dùng, kiểm định và chế biến do chủ dự án cung cấp.
 */
import type { StaticImageData } from "next/image";
import heroAgritrace from "../../../../public/images/site/hero-agritrace-v2.webp";
import aboutGrowerPartner from "../../../../public/images/site/about-grower-partner.webp";
import teaHills from "../../../../public/images/site/tea-hills.jpg";
import teaLeaves from "../../../../public/images/site/tea-leaves.jpg";
import roleFarm from "../../../../public/images/site/role-farm.jpg";
import roleProcessing from "../../../../public/images/site/role-processing-drying.jpg";
import roleTransport from "../../../../public/images/site/role-transport.jpg";
import roleRetail from "../../../../public/images/site/role-retail.jpg";
import roleInspection from "../../../../public/images/site/role-inspection-lab.jpg";
import roleConsumer from "../../../../public/images/site/role-consumer-market.jpg";

export const PHOTOS = { heroAgritrace, aboutGrowerPartner, teaHills, teaLeaves };

export const PHOTO_CREDITS = [
  ["tea-hills", "Colin Roe", "https://unsplash.com/photos/H1RWuPMIgBY"],
  ["tea-leaves", "Rashid", "https://unsplash.com/photos/New8EgKnSds"],
  ["role-farm", "feifei liang", "https://unsplash.com/photos/K7DllgDsGNo"],
  ["role-transport", "Zoshua Colah", "https://unsplash.com/photos/qpFY19VSGQU"],
  ["role-retail", "Thomas Le", "https://unsplash.com/photos/pRJhn4MbsMM"],
] as const;

export type Solution = { slug: string; image: StaticImageData; title: string; summary: string; points: string[] };

export const SOLUTIONS: Solution[] = [
  {
    slug: "nong-trai",
    image: roleFarm,
    title: "Nông trại và hợp tác xã",
    summary: "Ghi nhật ký vụ sản xuất, vùng trồng, vật tư và thu hoạch ngay tại hiện trường.",
    points: ["Vụ sản xuất gắn vùng trồng và sản phẩm", "Nhật ký canh tác kèm chứng cứ ảnh, tài liệu", "Mỗi lần thu hoạch tạo một lô hàng có mã riêng"],
  },
  {
    slug: "che-bien",
    image: roleProcessing,
    title: "Nhà chế biến",
    summary: "Nhận nguyên liệu từ nhiều lô, ghi nhận quy trình chế biến và tạo lô thành phẩm.",
    points: ["Đầu vào và đầu ra theo đơn vị quy đổi", "Lô thành phẩm giữ liên kết tới lô nguyên liệu", "Mã QR truy xuất riêng cho từng lô thành phẩm"],
  },
  {
    slug: "van-chuyen",
    image: roleTransport,
    title: "Vận chuyển và phân phối",
    summary: "Bàn giao có ký xác nhận giữa các bên, theo dõi số lượng thực nhận và hàng trả.",
    points: ["Kế hoạch giao nhận đồng thuận từng bên", "Ký nhận trên điện thoại khi bàn giao", "Hành trình GPS của xe được niêm phong khi ký nhận"],
  },
  {
    slug: "ban-le",
    image: roleRetail,
    title: "Nhà bán lẻ",
    summary: "Nhận hàng, kiểm tra nguồn gốc và cho người mua quét mã ngay tại quầy.",
    points: ["Xác nhận nhận hàng và số lượng", "Thông báo thu hồi hiển thị trên trang truy xuất", "Tiếp nhận phản ánh từ người tiêu dùng"],
  },
  {
    slug: "kiem-dinh",
    image: roleInspection,
    title: "Kiểm định và cơ quan quản lý",
    summary: "Xem nhật ký và giấy tờ của doanh nghiệp được giao kiểm tra, không sửa được dữ liệu.",
    points: ["Quyền chỉ đọc theo phân công", "Kiểm tra dữ liệu có bị sửa hay không", "Xem chứng nhận doanh nghiệp đã công bố"],
  },
  {
    slug: "nguoi-tieu-dung",
    image: roleConsumer,
    title: "Người tiêu dùng",
    summary: "Quét mã trên bao bì để xem nguồn gốc, hành trình và giấy tờ của lô hàng.",
    points: ["Không cần cài ứng dụng hay đăng nhập", "Xem cảnh báo hết hạn, thu hồi riêng biệt", "Gửi phản ánh khi thông tin chưa đúng"],
  },
];

export const TRACE_STEPS: { title: string; copy: string }[] = [
  { title: "Vụ sản xuất", copy: "Doanh nghiệp mở vụ, chọn vùng trồng và ghi nhật ký canh tác kèm ảnh." },
  { title: "Thu hoạch", copy: "Mỗi lần thu hoạch ghi ngày hái, sản lượng và nhiệt độ, độ ẩm đo được." },
  { title: "Lô hàng", copy: "Mỗi lô hàng có mã QR riêng, số lượng được kiểm đếm ở từng bước." },
  { title: "Giao nhận", copy: "Chuyến hàng ghi bàn giao từng bên tới khi lô đến tay nhà bán lẻ." },
];

export const PLATFORM_FEATURES: { title: string; copy: string }[] = [
  { title: "Thông tin kiểm tra được", copy: "Dữ liệu đã ghi không sửa được; cảnh báo và chứng nhận hiện riêng, rõ ràng." },
  { title: "Theo từng lô hàng", copy: "Xem nguồn nguyên liệu, lịch sử sản xuất và hành trình giao nhận." },
  { title: "Truy xuất công khai", copy: "Không cần đăng nhập để đọc thông tin được cho phép công bố." },
  { title: "Cảm biến và định vị", copy: "Cảm biến ghi nhiệt độ, độ ẩm tại vùng trồng; GPS ghi hành trình xe khi vận chuyển." },
];

export type Plan = { name: string; audience: string; features: string[]; highlight?: boolean };

export const PLANS: Plan[] = [
  {
    name: "Khởi đầu",
    audience: "Hộ sản xuất, hợp tác xã mới bắt đầu số hóa",
    features: ["Hồ sơ doanh nghiệp và danh mục sản phẩm", "Vụ sản xuất, nhật ký và thu hoạch", "Mã QR truy xuất công khai cho từng lô"],
  },
  {
    name: "Doanh nghiệp",
    audience: "Doanh nghiệp sản xuất, chế biến có nhiều cơ sở",
    features: ["Toàn bộ gói Khởi đầu", "Chế biến, đóng gói và lô thành phẩm", "Phân quyền thành viên theo vai trò", "Chứng cứ, chứng nhận và thông báo thu hồi"],
    highlight: true,
  },
  {
    name: "Chuỗi cung ứng",
    audience: "Chuỗi nhiều bên cùng chia sẻ dữ liệu giao nhận",
    features: ["Toàn bộ gói Doanh nghiệp", "Kế hoạch giao nhận, các bên cùng ký nhận", "Máy chủ lưu trữ riêng cho chuỗi", "Cảm biến vùng trồng và định vị GPS theo chuyến"],
  },
];
