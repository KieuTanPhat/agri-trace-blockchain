import { canAccessManagementRoute, platformAdminHome } from "./permissions";
import {
  canUseEnterpriseRoute,
  type EnterpriseAccess,
} from "./enterprise-access";
import type { Role } from "./types";

/**
 * Single source for the management navigation, breadcrumbs and mobile
 * shortcuts. Who may open a route stays in `permissions.ts` and
 * `enterprise-access.ts`; the API still authorizes every request.
 */
export type ManagementArea = "platform" | "enterprise";
export type NavItem = {
  href: string;
  label: string;
  /** Offered in the mobile bottom bar when the viewer may open it. */
  mobile?: boolean;
  /** Reached from a page rather than the sidebar; still named in breadcrumbs. */
  hidden?: boolean;
};
export type NavGroup = {
  title: string;
  area: ManagementArea;
  items: NavItem[];
};

export const navigationGroups: NavGroup[] = [
  {
    title: "Tổng quan",
    area: "platform",
    items: [
      {
        href: "/admin",
        label: "Tổng quan quản trị",
        mobile: true,
      },
    ],
  },
  {
    title: "Doanh nghiệp & tổ chức",
    area: "platform",
    items: [
      {
        href: "/admin/enterprises",
        label: "Xét duyệt doanh nghiệp",
        mobile: true,
      },
      {
        href: "/admin/enterprises/amendments",
        label: "Điều chỉnh hồ sơ",
      },
      { href: "/admin/organizations", label: "Tổ chức" },
      { href: "/admin/inspectors", label: "Kiểm định viên" },
      {
        href: "/admin/products",
        label: "Sản phẩm doanh nghiệp",
        hidden: true,
      },
      {
        href: "/admin/compliance-assignments",
        label: "Phân công kiểm định",
        hidden: true,
      },
    ],
  },
  {
    title: "Tài khoản & phê duyệt",
    area: "platform",
    items: [
      { href: "/admin/users", label: "Tài khoản hệ thống" },
      {
        href: "/admin/approvals",
        label: "Phê duyệt hai bước",
      },
    ],
  },
  {
    title: "Giám sát & tuân thủ",
    area: "platform",
    items: [
      {
        href: "/admin/operations",
        label: "Vận hành hệ thống",
        mobile: true,
      },
      {
        href: "/admin/audit-log",
        label: "Nhật ký kiểm toán",
        mobile: true,
      },
      {
        href: "/admin/cases",
        label: "Sự cố và khiếu nại",
        mobile: true,
      },
      { href: "/admin/recall", label: "Diễn tập thu hồi" },
      {
        href: "/admin/privacy",
        label: "Bảo vệ dữ liệu cá nhân",
        mobile: true,
      },
    ],
  },
  {
    title: "Công việc",
    area: "enterprise",
    items: [
      { href: "/dashboard", label: "Tổng quan", mobile: true },
      { href: "/enterprise/inbox", label: "Hộp công việc", mobile: true },
      { href: "/enterprise/help", label: "Hướng dẫn công việc" },
    ],
  },
  {
    title: "Quản trị",
    area: "enterprise",
    items: [
      { href: "/enterprise/members", label: "Quản lý thành viên" },
      { href: "/enterprise/roles", label: "Quản lý phân quyền" },
      { href: "/enterprise/messages", label: "Quản lý thông báo" },
    ],
  },
  {
    title: "Tổ chức",
    area: "enterprise",
    items: [
      { href: "/enterprise", label: "Tổng quan doanh nghiệp" },
      { href: "/enterprise/profile", label: "Hồ sơ doanh nghiệp" },
      { href: "/enterprise/partners", label: "Doanh nghiệp liên kết" },
      { href: "/supply-chains", label: "Quản lý chuỗi truy xuất" },
      { href: "/enterprise/connections", label: "Quản lý blockchain" },
    ],
  },
  {
    title: "Sản xuất",
    area: "enterprise",
    items: [
      { href: "/enterprise/products", label: "Quản lý sản phẩm" },
      { href: "/production-cycles", label: "Quản lý vụ trồng" },
      { href: "/enterprise/areas", label: "Quản lý vùng sản xuất" },
      { href: "/enterprise/materials", label: "Quản lý giống & vật tư" },
      { href: "/lots", label: "Quản lý lô nông sản", mobile: true },
      { href: "/iot-simulator", label: "Cảm biến IoT" },
      { href: "/enterprise/qr", label: "Tem truy xuất QR" },
    ],
  },
  {
    title: "Phân phối & kho",
    area: "enterprise",
    items: [
      { href: "/enterprise/sites", label: "Cơ sở" },
      { href: "/enterprise/vehicles", label: "Phương tiện" },
      { href: "/enterprise/inventory", label: "Tồn kho & cách ly cơ sở" },
      { href: "/distribution", label: "Phân phối & giao nhận", mobile: true },
      { href: "/enterprise/reports/adjust", label: "Ghi bán & hao hụt" },
      { href: "/enterprise/signing", label: "Thiết bị ký bàn giao" },
    ],
  },
  {
    title: "Chất lượng & báo cáo",
    area: "enterprise",
    items: [
      { href: "/enterprise/notices", label: "Cảnh báo & thu hồi" },
      { href: "/compliance", label: "Kiểm định, chứng nhận" },
      { href: "/enterprise/reports", label: "Báo cáo & đối soát" },
    ],
  },
  {
    title: "Dịch vụ & cài đặt",
    area: "enterprise",
    items: [
      { href: "/enterprise/onboarding", label: "Hồ sơ xét duyệt" },
      { href: "/enterprise/service", label: "Dịch vụ & hợp đồng" },
      { href: "/enterprise/settings", label: "Cài đặt" },
    ],
  },
];

/** Personal pages reached from the account menu rather than the sidebar. */
export const accountLinks: NavItem[] = [
  { href: "/admin/security", label: "Bảo mật tài khoản" },
  { href: "/account/password", label: "Đổi mật khẩu" },
  { href: "/account/privacy", label: "Quyền dữ liệu cá nhân" },
];

const exactRoutes = new Set(["/dashboard", "/enterprise", "/admin"]);

export function isActiveRoute(pathname: string, href: string) {
  return exactRoutes.has(href)
    ? pathname === href
    : pathname === href || pathname.startsWith(href + "/");
}

export type RouteViewer = {
  role: Role;
  productionAccess?: boolean;
  /** Present for enterprise members; `null` while it is not yet loaded. */
  enterpriseAccess?: EnterpriseAccess | null;
  enterpriseUser: boolean;
};

export function canOpenRoute(href: string, viewer: RouteViewer) {
  return (
    canAccessManagementRoute(href, viewer.role, viewer.productionAccess) &&
    (!viewer.enterpriseUser ||
      (!!viewer.enterpriseAccess &&
        canUseEnterpriseRoute(href, viewer.enterpriseAccess)))
  );
}

export function primaryArea(role: Role): ManagementArea {
  return platformAdminHome(role) ? "platform" : "enterprise";
}

/** Groups the viewer may use, their own area first. */
export function visibleGroups(viewer: RouteViewer): NavGroup[] {
  const first = primaryArea(viewer.role);
  return [...navigationGroups]
    .sort((a, b) => Number(b.area === first) - Number(a.area === first))
    .map((group) => ({
      ...group,
      items: group.items.filter(
        ({ href, hidden }) => !hidden && canOpenRoute(href, viewer),
      ),
    }))
    .filter((group) => group.items.length);
}

export function visibleAccountLinks(viewer: RouteViewer) {
  return accountLinks.filter(({ href }) =>
    canAccessManagementRoute(href, viewer.role, viewer.productionAccess),
  );
}

/** Up to four bottom-bar shortcuts: flagged items first, then the rest. */
export function mobileShortcuts(groups: NavGroup[], limit = 4): NavItem[] {
  const items = groups.flatMap((group) => group.items);
  return [
    ...items.filter((item) => item.mobile),
    ...items.filter((item) => !item.mobile),
  ].slice(0, limit);
}

export function homeRoute(role: Role, enterpriseUser: boolean) {
  return (
    platformAdminHome(role) ?? (enterpriseUser ? "/enterprise" : "/dashboard")
  );
}

/** The navigation entry a page belongs to, for breadcrumbs. */
export function routeContext(pathname: string) {
  let best: { group: Pick<NavGroup, "title">; item: NavItem } | null = null;
  for (const group of [
    ...navigationGroups,
    { title: "Tài khoản", area: "platform", items: accountLinks } as NavGroup,
  ])
    for (const item of group.items)
      if (
        (pathname === item.href || pathname.startsWith(item.href + "/")) &&
        (!best || item.href.length > best.item.href.length)
      )
        best = { group, item };
  return best;
}
