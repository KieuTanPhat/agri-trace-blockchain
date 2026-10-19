/** Fields, columns and sub-pages inside each management page, so the top-bar
 * search can answer "điện thoại" with a path such as
 * Quản trị › Quản lý thành viên › Thêm thành viên › Số điện thoại liên hệ.
 *
 * Keys are sidebar hrefs (only entries whose page the viewer may open are
 * offered). `href` defaults to the key; `page` names a sub-page in the path.
 * Field labels are written as the page shows them so the page can scroll to
 * and highlight the matching label, column or heading after navigation.
 * Pages that need a record id (detail pages) are not listed. */
export type FieldSection = { page?: string; href?: string; fields: string[] };

const siteFields = [
  "Tên cơ sở", "Loại cơ sở", "Địa chỉ", "Tỉnh / thành phố", "Phường / xã",
  "Sức chứa tối đa (kg)", "Sản lượng dự kiến (tấn/năm)", "Vùng sản xuất liên kết",
  "Người quản lý cơ sở", "Nhân viên phụ trách", "Người đại diện", "Điện thoại", "Email",
  "Thông tin khác",
];
const productFields = [
  "Tên sản phẩm", "Mã sản phẩm", "Danh mục sản phẩm", "Vùng sản xuất xuất xứ",
  "Mã vạch GTIN", "Giá sản phẩm", "Điều kiện bảo quản", "Thành phần",
  "Hướng dẫn sử dụng", "Giống / phân loại", "Đơn vị mặc định", "Nguyên liệu",
  "Nhà xưởng sản xuất", "Nhà xuất khẩu", "Nhà nhập khẩu", "Nhà phân phối",
  "Nhà vận chuyển", "Người quản lí",
];
const areaFields = [
  "Vị trí / địa chỉ", "Loại vùng sản xuất", "Khu vực", "Địa chỉ cụ thể",
  "Sản lượng dự kiến", "Đơn vị sản lượng", "Mã vụ trồng", "Vật tư đầu vào", "Loại giống",
  "Nhà xưởng liên kết", "Quyền hiển thị thông tin",
  "Người đại diện", "Điện thoại liên hệ", "Email liên hệ", "Thông tin khác",
];
const partnerFields = [
  "Loại hồ sơ", "Mã doanh nghiệp / từ khóa tìm kiếm", "Lời nhắn", "Tên doanh nghiệp",
  "Loại hình", "Địa chỉ doanh nghiệp", "Số điện thoại", "Email", "Mã số thuế",
  "Người đại diện", "Ghi chú",
];
const memberFields = [
  "Họ tên", "Email đăng nhập", "Cấp tài khoản", "Chức danh", "Số điện thoại liên hệ",
  "Cơ sở làm việc", "Vùng sản xuất phụ trách", "Địa chỉ liên hệ", "Ghi chú thành viên",
  "Nhóm quyền", "Phạm vi chuỗi", "Cơ sở / nông trại được phân công",
];
const profileFields = [
  "Mã tổ chức AgriTrace", "Hoạt động đã duyệt", "Điện thoại", "Email liên hệ",
  "Giới thiệu", "Tên tổ chức", "Loại hình", "Mã số thuế / mã hộ kinh doanh",
  "Số giấy đăng ký", "Người đại diện", "Chức vụ người đại diện", "Tỉnh / thành phố",
  "Xã / phường", "Địa chỉ", "Mã vùng trồng", "Mã cơ sở đóng gói", "Quy mô ước tính",
  "Số cơ sở", "Lịch sử phiên bản hồ sơ", "Giấy tờ pháp lý riêng tư",
  "Điều chỉnh thông tin pháp lý",
];
const cycleFields = [
  "Tên vụ trồng", "Nông trại", "Thửa đất", "Sản phẩm", "Ngày bắt đầu",
  "Dự kiến thu hoạch", "Đơn vị thu hoạch", "Phương pháp canh tác", "Ghi chú",
];

export const fieldIndex: Record<string, FieldSection[]> = {
  // ---- Doanh nghiệp ----
  "/enterprise/inbox": [{ fields: ["Yêu cầu chuyển quyền chủ quản", "Yêu cầu từ nền tảng", "Xác nhận đã nhận", "Gửi phản hồi"] }],
  "/enterprise/members": [
    { fields: ["Thành viên", "Cấp tài khoản", "Nhóm quyền", "Trạng thái", "Thao tác", "Quyền & trạng thái"] },
    { page: "Thêm thành viên", href: "/enterprise/members/new", fields: memberFields },
    { page: "Lời mời đang gửi", href: "/enterprise/members/invitations", fields: ["Lời mời thành viên"] },
    { page: "Chuyển quyền chủ quản", href: "/enterprise/ownership", fields: ["Người nhận", "Sau khi chuyển", "Lý do", "Yêu cầu chuyển quyền"] },
  ],
  "/enterprise/roles": [
    { fields: ["Nhóm quyền"] },
    { page: "Tạo nhóm quyền", href: "/enterprise/roles/new", fields: ["Mẫu theo công việc", "Tên nhóm quyền"] },
    { fields: ["Chỉnh sửa"] },
  ],
  "/enterprise/messages": [{ fields: ["Soạn thông báo", "Tiêu đề", "Thành viên nhận", "Nội dung", "Danh sách thông báo", "Nội dung trả lời"] }],
  "/enterprise": [{ fields: ["Thành viên", "Cơ sở", "Sản phẩm riêng", "Giao nhận", "Hoạt động doanh nghiệp"] }],
  "/enterprise/profile": [{ fields: profileFields }],
  "/enterprise/partners": [
    { fields: ["Doanh nghiệp", "Lời mời", "Trạng thái"] },
    { page: "Thêm doanh nghiệp", href: "/enterprise/partners/new", fields: partnerFields },
  ],
  "/enterprise/connections": [{ fields: ["Chuỗi của doanh nghiệp", "Kết nối một chuỗi", "Cổng peer", "Tên máy trong chứng thư TLS", "MSP của doanh nghiệp", "Yêu cầu kết nối", "Mã giao dịch kiểm chứng"] }],
  "/enterprise/products": [
    { fields: ["Hình ảnh", "Tên sản phẩm", "Giống / phân loại", "Đơn vị", "Trạng thái"] },
    { page: "Thêm sản phẩm", href: "/enterprise/products/new", fields: productFields },
    { page: "Nhập danh mục CSV", href: "/enterprise/products/import", fields: ["File CSV", "Mã SKU"] },
  ],
  "/production-cycles": [
    { fields: ["Mã vụ", "Sản phẩm", "Vùng sản xuất", "Trạng thái"] },
    { page: "Tạo vụ sản xuất", href: "/production-cycles/new", fields: cycleFields },
  ],
  "/enterprise/areas": [
    { fields: ["Nông trại", "Vị trí", "Trạng thái"] },
    { page: "Thêm vùng sản xuất", href: "/enterprise/areas/new", fields: areaFields },
    { page: "Thêm thửa đất", href: "/enterprise/areas/plots/new", fields: ["Diện tích", "Đơn vị diện tích"] },
  ],
  "/enterprise/materials": [
    { fields: ["Mã / tên", "Loại", "Nhà cung cấp / lô", "Đơn vị", "Cách ly khai báo", "Trạng thái"] },
    { page: "Thêm giống / vật tư", href: "/enterprise/materials/new", fields: ["Mã đầu vào", "Tên", "Loại", "Loại giống", "Đơn vị", "Giá", "Xuất xứ", "Nhà sản xuất", "Nhà cung cấp", "Mô tả", "Lô đầu vào", "Thành phần / hoạt chất", "Cách ly khai báo (ngày)", "Hạn dùng"] },
  ],
  "/lots": [{ fields: ["Nông sản", "Mã lô", "Nông trại", "Cập nhật gần nhất", "Trạng thái", "Tìm lô", "Lọc trạng thái", "Lọc trang trại", "Tổng số lô", "Đang vận chuyển", "Đã thu hoạch"] }],
  "/iot-simulator": [{ fields: ["Thiết bị", "Vụ trồng", "Loại cảm biến", "Giá trị và đơn vị", "Thời điểm ghi nhận UTC", "Cấu hình cảm biến"] }],
  "/enterprise/qr": [{ fields: ["Mẫu tem", "Số tem", "Lịch sử in của tổ chức"] }],
  "/enterprise/sites": [
    { fields: ["Tên cơ sở", "Loại cơ sở", "Địa chỉ", "Trạng thái"] },
    { page: "Thêm cơ sở", href: "/enterprise/sites/new", fields: siteFields },
  ],
  "/enterprise/vehicles": [
    { fields: ["Biển số / mã phương tiện", "Loại phương tiện", "Trạng thái"] },
    { page: "Thêm phương tiện", href: "/enterprise/vehicles/new", fields: ["Biển số / mã phương tiện", "Loại phương tiện"] },
  ],
  "/enterprise/inventory": [{ fields: ["Tồn kho theo cơ sở", "Phân bổ lượng chưa gắn cơ sở", "Lập phiếu chuyển hàng giữa các cơ sở", "Phiếu chuyển kho", "Lập phiếu cách ly", "Phiếu cách ly", "Cơ sở xuất hàng", "Cơ sở nhận hàng", "Lý do chuyển hàng", "Khối lượng thực nhận", "Cơ sở đang giữ", "Nguyên nhân"] }],
  "/distribution": [
    { fields: ["Giao nhận", "Bên giao → Bên nhận", "Đơn vị vận chuyển", "Lượng hàng", "Trạng thái"] },
    { page: "Tạo giao nhận", href: "/distribution/new", fields: ["Chuỗi cung ứng", "Doanh nghiệp nhận", "Doanh nghiệp vận chuyển", "Điểm giao", "Điểm nhận", "Ngày giờ dự kiến lấy hàng", "Ghi chú giao nhận", "Lô nguồn", "Số lượng"] },
  ],
  "/enterprise/reports/adjust": [{ fields: ["Lô đang giữ", "Cơ sở giữ hàng", "Loại ghi nhận", "Lý do"] }],
  "/enterprise/signing": [{ fields: ["Khóa", "Ngày tạo", "Trạng thái"] }],
  "/enterprise/notices": [{ fields: ["Lô nguồn", "Loại thông báo", "Nội dung công khai"] }],
  "/compliance": [{ fields: ["Chứng nhận đang chờ duyệt", "Loại chứng nhận", "Đơn vị cấp", "Ngày cấp", "Ngày hết hạn", "Lô được phân công", "Kết quả", "Thời điểm kiểm định", "Lịch sử kiểm định"] }],
  "/enterprise/reports": [{ fields: ["Tìm lô / sản phẩm", "Cơ sở", "Hết hạn đến ngày", "Lô nguồn", "Lượng nguồn", "Đang giữ", "Đã dành giao", "Có thể giao tiếp", "Hành trình phân phối"] }],
  "/enterprise/onboarding": [{ fields: ["Mã số doanh nghiệp", "Email nhận thông báo", "Ghi chú xét duyệt", "Tài liệu hồ sơ", "Bổ sung và gửi lại hồ sơ"] }],
  "/enterprise/settings": [{ fields: ["Kiểu chữ hiển thị", "Font toàn hệ thống", "Mẫu nhanh", "Cỡ chữ (px)", "Độ đậm", "Xem trước", "Khôi phục thiết kế gốc"] }],
  "/enterprise/service": [{ fields: ["Mô hình vận hành", "Tên đơn vị thanh toán", "Email thanh toán", "Địa chỉ thanh toán", "Hợp đồng điện tử", "Thanh toán dịch vụ"] }],
  // ---- Quản trị nền tảng ----
  "/admin": [{ fields: ["Hồ sơ chờ duyệt", "Công việc đang chờ", "Công việc khác"] }],
  "/admin/enterprises": [{ fields: ["Danh sách hồ sơ", "Lọc trạng thái hồ sơ", "Chờ duyệt", "Đã duyệt", "Từ chối"] }],
  "/admin/enterprises/amendments": [{ fields: ["Danh sách hồ sơ điều chỉnh"] }],
  "/admin/organizations": [
    { fields: ["Danh sách tổ chức", "Lọc loại tổ chức"] },
    { page: "Tạo tổ chức kiểm định", href: "/admin/organizations/new", fields: ["Tên tổ chức kiểm định"] },
  ],
  "/admin/inspectors": [{ fields: ["Tổ chức kiểm định", "Tài khoản kiểm định viên", "Phân công và lịch sử"] }],
  "/admin/products": [{ fields: ["Doanh nghiệp", "Lĩnh vực", "Sản phẩm", "Thống kê sản phẩm", "Mã sản phẩm", "Giống / phân loại", "Đơn vị"] }],
  "/admin/compliance-assignments": [
    { fields: ["Danh sách phân công", "Lọc trạng thái phân công"] },
    { page: "Tạo phân công", href: "/admin/compliance-assignments/new", fields: ["Người kiểm định", "Nông trại", "Lý do phân công"] },
  ],
  "/admin/users": [
    { fields: ["Danh sách tài khoản nền tảng", "Lọc nhóm tài khoản"] },
    { page: "Tạo tài khoản", href: "/admin/users/new", fields: ["Họ và tên", "Email đăng nhập", "Tổ chức kiểm định", "Loại tài khoản"] },
  ],
  "/admin/approvals": [
    { fields: ["Danh sách đề xuất", "Lọc trạng thái đề xuất"] },
    { page: "Tạo đề xuất", href: "/admin/approvals/new", fields: ["Loại thao tác cần phê duyệt", "Tài khoản được cấp quyền", "Tổ chức", "Năng lực", "Phạm vi quản trị", "Họ và tên", "Email đăng nhập"] },
  ],
  "/admin/operations": [{ fields: ["Hàng đợi ghi sổ cái", "Hold giao nhận", "Tác vụ điều khiển sổ cái", "Sức khỏe kết nối", "Chứng thư & khóa ký", "Hàng đợi thư", "Phiên đang hoạt động", "Lọc theo chuỗi", "Lọc theo tổ chức"] }],
  "/admin/audit-log": [{ fields: ["Thời điểm", "Người thực hiện", "Hành động", "Đối tượng", "Lý do / chi tiết", "Lọc theo hành động", "Lọc theo loại đối tượng"] }],
  "/admin/cases": [
    { fields: ["Danh sách hồ sơ", "Lọc trạng thái", "Lọc mức độ"] },
    { page: "Tiếp nhận hồ sơ", href: "/admin/cases/new", fields: ["Tiêu đề", "Phân loại", "Mức độ", "Nguồn tiếp nhận"] },
  ],
  "/admin/recall": [{ fields: ["ID lô nguồn", "Lượng ban đầu", "Lượng khả dụng ghi nhận", "Phân bổ theo doanh nghiệp", "Chặng liên quan"] }],
  "/admin/privacy": [{ fields: ["Loại yêu cầu", "Phạm vi phản hồi", "Thời hạn / báo cáo", "Lịch sử xử lý"] }],
  "/admin/security": [{ fields: ["Xác thực hai yếu tố", "Mã khôi phục còn lại", "Mã 6 số", "Tắt MFA", "Cấp lại mã khôi phục"] }],
  "/account/password": [{ fields: ["Mật khẩu hiện tại", "Mật khẩu mới"] }],
  "/account/privacy": [{ fields: ["Gửi yêu cầu quyền dữ liệu", "Loại yêu cầu", "Yêu cầu của bạn"] }],
};
