import {t as tr} from './i18n';
export type LedgerNavItem={href:string;label:string;readOnly?:boolean;keywords?:string;count?:string[];badge?:string};
export type LedgerNavGroup={label:string;items:LedgerNavItem[]};
export const PLATFORM_NAV: LedgerNavGroup[] = [
    {
        get label() { return tr("Bàn làm việc"); },
        items: [
            { href: "/admin/inbox", get label() { return tr("Hàng đợi quyết định"); }, count: ["ENROLLMENT", "CAPABILITY", "AMENDMENT", "CONNECTION", "TICKET", "CONSUMER_REPORT", "CASE", "INVOICE_OVERDUE"], get keywords() { return tr("inbox việc chờ"); } },
            { href: "/admin", get label() { return tr("Tổng quan nền tảng"); }, readOnly: true, get keywords() { return tr("dashboard thống kê"); } },
        ]
    },
    {
        get label() { return tr("Doanh nghiệp"); },
        items: [
            { href: "/admin/enterprises", get label() { return tr("Hồ sơ đăng ký"); }, count: ["ENROLLMENT", "CAPABILITY", "CONNECTION"], get keywords() { return tr("enrollment duyệt hồ sơ năng lực kích hoạt"); } },
            { href: "/admin/enterprises/amendments", get label() { return tr("Điều chỉnh hồ sơ"); }, count: ["AMENDMENT"], get keywords() { return tr("amendment sửa hồ sơ"); } },
            { href: "/admin/directory", get label() { return tr("Danh bạ tổ chức"); }, get keywords() { return tr("tổ chức doanh nghiệp organization"); } },
            { href: "/admin/chains", get label() { return tr("Chuỗi cung ứng"); }, readOnly: true, keywords: "supply chain" },
        ]
    },
    {
        get label() { return tr("Kiểm soát"); },
        items: [
            { href: "/admin/users", get label() { return tr("Tài khoản nền tảng"); }, get keywords() { return tr("user người dùng khóa mở"); } },
            { href: "/admin/inspectors", get label() { return tr("Kiểm định độc lập"); }, get keywords() { return tr("kiểm định auditor compliance reviewer phân công vùng sản xuất"); } },
            { href: "/admin/audit-log", get label() { return tr("Nhật ký kiểm toán"); }, readOnly: true, get keywords() { return tr("audit log chuỗi băm"); } },
            { href: "/admin/security", get label() { return tr("Cảnh báo bảo mật"); }, readOnly: true, get keywords() { return tr("security mfa khóa"); } },
        ]
    },
    {
        get label() { return tr("Sự cố & hỗ trợ"); },
        items: [
            { href: "/admin/cases", get label() { return tr("Hồ sơ sự cố"); }, count: ["CASE"], get keywords() { return tr("case khiếu nại"); } },
            { href: "/admin/reports", get label() { return tr("Báo cáo người tiêu dùng"); }, count: ["CONSUMER_REPORT"], get keywords() { return tr("consumer report phản ánh"); } },
            { href: "/admin/support", get label() { return tr("Yêu cầu hỗ trợ"); }, count: ["TICKET"], keywords: "ticket support" },
            { href: "/admin/privacy", get label() { return tr("Quyền dữ liệu cá nhân"); }, get keywords() { return tr("privacy vi phạm breach"); } },
        ]
    },
    {
        get label() { return tr("Truy xuất"); },
        items: [
            { href: "/admin/lots", get label() { return tr("Tra cứu lô & QR"); }, get keywords() { return tr("lot qr khóa tem"); } },
            { href: "/admin/recall", get label() { return tr("Diễn tập thu hồi"); }, readOnly: true, get keywords() { return tr("recall thu hồi"); } },
            { href: "/admin/trace-report", get label() { return tr("Báo cáo truy xuất"); }, readOnly: true, get keywords() { return tr("trace report KDE csv xuất dữ liệu lô"); } },
        ]
    },
    {
        get label() { return tr("Thương mại"); },
        items: [
            { href: "/admin/billing/subscriptions", get label() { return tr("Doanh thu & thuê bao"); }, keywords: "revenue subscription" },
            { href: "/admin/billing/invoices", get label() { return tr("Hóa đơn"); }, count: ["INVOICE_OVERDUE"], get keywords() { return tr("invoice thanh toán"); } },
            { href: "/admin/billing", get label() { return tr("Bảng giá"); }, get keywords() { return tr("plan gói"); } },
        ]
    },
    {
        get label() { return tr("Vận hành"); },
        items: [
            { href: "/admin/operations", get label() { return tr("Tình trạng hệ thống"); }, readOnly: true, keywords: "outbox mail hold monitoring" },
            { href: "/admin/ledger", get label() { return tr("Sổ cái blockchain"); }, readOnly: true, keywords: "ledger fabric tx" },
        ]
    },
    {
        get label() { return tr("Cấu hình"); },
        items: [
            { href: "/admin/settings", get label() { return tr("Tham số nền tảng"); }, keywords: "setting" },
            { href: "/admin/notices", get label() { return tr("Thông báo hệ thống"); }, keywords: "notice banner" },
            { href: "/admin/news", get label() { return tr("Quản lí bản tin"); }, keywords: "news article mobile tin tức" },
            { href: "/admin/reference-data", get label() { return tr("Danh mục tham chiếu"); }, get keywords() { return tr("reference đơn vị"); } },
        ]
    },
];
export const WORKSPACE_NAV: LedgerNavGroup[] = [
    {
        get label() { return tr("Doanh nghiệp"); },
        items: [
            { href: "/enterprise", get label() { return tr("Tổng quan"); } },
            { href: "/enterprise/profile", get label() { return tr("Hồ sơ doanh nghiệp"); } },
            { href: "/enterprise/members", get label() { return tr("Thành viên"); } },
            { href: "/enterprise/roles", get label() { return tr("Nhóm quyền"); } },
        ]
    },
    {
        get label() { return tr("Tài nguyên"); },
        items: [
            { href: "/enterprise/sites", get label() { return tr("Cơ sở"); } },
            { href: "/enterprise/vehicles", get label() { return tr("Phương tiện"); } },
            { href: "/enterprise/areas", get label() { return tr("Vùng sản xuất"); } },
            { href: "/enterprise/products", get label() { return tr("Sản phẩm"); } },
            { href: "/enterprise/materials", get label() { return tr("Giống & vật tư"); } },
            { href: "/supply-chains", get label() { return tr("Chuỗi cung ứng"); } },
            { href: "/enterprise/partners", get label() { return tr("Đối tác"); } },
        ]
    },
    {
        get label() { return tr("Tác nghiệp"); },
        items: [
            { href: "/production-cycles", get label() { return tr("Vụ sản xuất"); } },
            { href: "/lots", get label() { return tr("Lô hàng"); } },
            { href: "/distribution", get label() { return tr("Giao nhận"); } },
            { href: "/enterprise/inventory", get label() { return tr("Tồn kho"); } },
            { href: "/enterprise/qr", get label() { return tr("Kho QR"); } },
            { href: "/enterprise/processing", get label() { return tr("Chế biến"); } },
        ]
    },
    {
        get label() { return tr("Phối hợp"); },
        items: [
            { href: "/enterprise/inbox", get label() { return tr("Sự cố được giao"); }, badge: "cases" },
            { href: "/enterprise/messages", get label() { return tr("Thông báo nội bộ"); }, badge: "messages" },
            { href: "/enterprise/support", get label() { return tr("Hỗ trợ từ nền tảng"); } },
            { href: "/enterprise/billing", get label() { return tr("Gói dịch vụ & hóa đơn"); } },
        ]
    },
];

export const canonicalNavigationUrls = new Set(["/account/password","/account/privacy","/admin/audit-log","/admin/backup","/admin/billing/invoices","/admin/billing","/admin/billing/revenue","/admin/billing/subscriptions","/admin/cases/[id]","/admin/cases/new","/admin/cases","/admin/chains","/admin/compliance-assignments/[id]","/admin/compliance-assignments/new","/admin/compliance-assignments","/admin/directory/[id]","/admin/directory","/admin/enterprises/[id]/connections/[connectionId]","/admin/enterprises/[id]","/admin/enterprises/amendments/[id]","/admin/enterprises/amendments","/admin/enterprises","/admin/inbox","/admin/inspectors","/admin/ledger","/admin/lots","/admin/monitoring","/admin/notices","/admin/notifications","/admin/operations","/admin/organizations/new","/admin/organizations","/admin","/admin/privacy","/admin/products/[organizationId]","/admin/products","/admin/qr","/admin/recall","/admin/reference-data","/admin/reports","/admin/roles","/admin/security-alerts","/admin/security","/admin/settings","/admin/statistics","/admin/support/[id]","/admin/support","/admin/trace-report","/admin/users/[id]","/admin/users/new","/admin/users","/compliance","/dashboard","/distribution/[id]/journal","/distribution/[id]","/distribution/new","/distribution","/enterprise/areas/[id]","/enterprise/areas/new","/enterprise/areas","/enterprise/areas/plots/new","/enterprise/billing","/enterprise/connections","/enterprise/help","/enterprise/inbox","/enterprise/inventory","/enterprise/materials/[id]","/enterprise/materials/new","/enterprise/materials","/enterprise/members/[id]/edit","/enterprise/members/[id]","/enterprise/members/invitations","/enterprise/members/new","/enterprise/members","/enterprise/messages","/enterprise/notices","/enterprise/notifications","/enterprise/onboarding","/enterprise","/enterprise/partners/external/[id]","/enterprise/partners/new","/enterprise/partners","/enterprise/processing/[id]","/enterprise/processing/conversions","/enterprise/processing/new","/enterprise/processing","/enterprise/products/[id]/edit","/enterprise/products/[id]","/enterprise/products/import","/enterprise/products/new","/enterprise/products","/enterprise/profile","/enterprise/qr","/enterprise/reports/adjust","/enterprise/reports","/enterprise/roles/[id]","/enterprise/roles/new","/enterprise/roles","/enterprise/service/contract","/enterprise/service","/enterprise/service/payment","/enterprise/settings","/enterprise/signing","/enterprise/sites/[id]","/enterprise/sites/new","/enterprise/sites","/enterprise/support/[id]","/enterprise/support/new","/enterprise/support","/enterprise/vehicles/[id]","/enterprise/vehicles/new","/enterprise/vehicles","/iot-simulator","/join-organization","/login","/lots/[lotId]","/lots","/","/privacy","/production-cycles/[id]/harvest/new","/production-cycles/[id]/harvest","/production-cycles/[id]/journal/new","/production-cycles/[id]/journal","/production-cycles/[id]","/production-cycles/[id]/plant","/production-cycles/drafts/[id]","/production-cycles/new","/production-cycles","/register","/scan","/supply-chains/[id]/business","/supply-chains/[id]/ledger","/supply-chains/[id]/members","/supply-chains/[id]","/supply-chains/[id]/plans","/supply-chains/[id]/roles","/supply-chains/[id]/signing","/supply-chains/new","/supply-chains","/terms","/trace/[lotId]"]);
canonicalNavigationUrls.add("/admin/news");
