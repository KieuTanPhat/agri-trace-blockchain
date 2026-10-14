"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  BadgeCheck,
  Blocks,
  Ellipsis,
  House,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  Package,
  ScanLine,
  Search,
  Settings2,
  Sprout,
  Thermometer,
  X,
  type LucideIcon,
} from "lucide-react";
import { SiteFooter, ZaloFloat } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BrandLogo } from "@/components/ui/brand-logo";
import { getLots } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { LotTrace } from "@/lib/types";
import { canAccessManagementRoute } from "@/lib/permissions";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { PendingCommandsPanel } from "./pending-commands-panel";

type NavItem = { href: string; label: string; icon: LucideIcon };

const navigationGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Vận hành",
    items: [
      { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
      { href: "/production-cycles", label: "Vụ trồng", icon: Sprout },
      { href: "/lots", label: "Lô nông sản", icon: Package },
      { href: "/supply-chains", label: "Chuỗi và đối tác", icon: Network },
    ],
  },
  {
    title: "Tuân thủ",
    items: [
      {
        href: "/compliance",
        label: "Kiểm định, chứng nhận",
        icon: BadgeCheck,
      },
    ],
  },
  {
    title: "Hệ thống",
    items: [
      { href: "/admin", label: "Quản trị", icon: Settings2 },
      { href: "/iot-simulator", label: "Cảm biến IoT", icon: Thermometer },
      { href: "/scan", label: "Quét mã QR", icon: ScanLine },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname.startsWith(href.split("/").slice(0, 2).join("/"));
}

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/scan" ||
    pathname.startsWith("/trace/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const authorizationScope = getAuthorizationScope(auth.user);
  const [searchData, setSearchData] = useState<{
    scope?: string;
    lots: LotTrace[];
  }>({ lots: [] });
  const privateAccessReady =
    !auth.privateAccessStatus || auth.privateAccessStatus === "ready";
  const lots =
    privateAccessReady && searchData.scope === authorizationScope
      ? searchData.lots
      : [];
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setSearchData({ lots: [] });
    setQuery("");
    setSearchFailed(false);
    if (!auth.isAuthenticated || isPublic) return;
    getLots()
      .then((items) => {
        if (active) setSearchData({ scope: authorizationScope, lots: items });
      })
      .catch(() => {
        if (active) setSearchFailed(true);
      });
    return () => {
      active = false;
    };
  }, [auth.isAuthenticated, authorizationScope, isPublic]);
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !isPublic)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.isAuthenticated, auth.isLoading, isPublic, pathname, router]);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    const dialog = mobileDialog.current;
    if (mobileOpen && dialog && !dialog.open) dialog.showModal();
    if (!mobileOpen && dialog?.open) dialog.close();
    if (!mobileOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const desktop = window.matchMedia("(min-width: 901px)");
    const resize = () => {
      if (desktop.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", resize);
    return () => {
      document.body.style.overflow = overflow;
      desktop.removeEventListener("change", resize);
    };
  }, [mobileOpen]);

  if (pathname === "/") return <>{children}</>;
  if (isPublic)
    return (
      <div className="public-shell">
        <a className="skip-link" href="#main-content">
          Đi đến nội dung
        </a>
        <SiteHeader />
        <main className="public-content" id="main-content">
          {children}
        </main>
        <SiteFooter />
        <ZaloFloat />
      </div>
    );
  if (auth.isLoading || !auth.isAuthenticated || !auth.user)
    return (
      <main className="public-content">
        <div className="loading-state">Đang kiểm tra phiên đăng nhập...</div>
      </main>
    );

  const role = auth.user.role.code;
  if (!canAccessManagementRoute(pathname, role, auth.user?.productionAccess))
    return (
      <main className="public-content">
        <div className="notice error" role="alert">
          Bạn không có quyền sử dụng chức năng này.
        </div>
        <Link className="text-link" href="/dashboard">
          Về tổng quan
        </Link>
      </main>
    );
  const roleName = auth.user.role.name || auth.user.role.code;
  const groups = navigationGroups
    .map((group) => ({
      ...group,
      items: group.items.filter(({ href }) =>
        canAccessManagementRoute(href, role, auth.user?.productionAccess),
      ),
    }))
    .filter((group) => group.items.length);
  const allowed = groups.flatMap((group) => group.items);
  const matching = query.trim().toLocaleLowerCase("vi")
    ? lots.filter((lot) =>
        `${lot.productName} ${lot.lotCode} ${lot.farmOrg.name}`
          .toLocaleLowerCase("vi")
          .includes(query.trim().toLocaleLowerCase("vi")),
      )
    : [];
  const renderGroups = (onNavigate?: () => void) =>
    groups.map((group) => (
      <div className="nav-group" key={group.title}>
        <p className="nav-group-title">{group.title}</p>
        {group.items.map(({ href, label, icon: Icon }) => (
          <Link
            className="nav-link"
            href={href}
            key={href}
            title={label}
            aria-current={isActive(pathname, href) ? "page" : undefined}
            onClick={onNavigate}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        ))}
      </div>
    ));

  return (
    <div className="app-shell" data-mobile-open={mobileOpen}>
      <a className="skip-link" href="#main-content">
        Đi đến nội dung
      </a>
      <header className="topbar">
        <button
          className="icon-button menu-button"
          type="button"
          aria-label={mobileOpen ? "Đóng điều hướng" : "Mở điều hướng"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-management-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link
          className="brand"
          href="/dashboard"
          aria-label="AgriTrace - Tổng quan"
        >
          <BrandLogo height={40} priority />
        </Link>
        <div className="header-search">
          <Search size={18} />
          <input
            aria-label="Tìm lô nông sản"
            placeholder="Tìm nông sản, mã lô, trang trại..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
          />
          {query.trim() && (
            <div className="search-results">
              {matching.map((lot) => (
                <Link
                  key={lot.lotId}
                  href={`/lots/${lot.lotId}`}
                  onClick={() => setQuery("")}
                >
                  <strong>{lot.productName}</strong>
                  <span>{lot.lotCode}</span>
                </Link>
              ))}
              {searchFailed ? (
                <p>Chưa tải được danh sách lô.</p>
              ) : (
                !matching.length && <p>Không tìm thấy lô phù hợp.</p>
              )}
            </div>
          )}
        </div>
        <div className="topbar-meta">
          <span className="workspace-avatar" aria-hidden="true">
            {auth.user.fullName.slice(0, 2).toUpperCase()}
          </span>
          <span>
            {auth.user.fullName}
            <small>{roleName}</small>
          </span>
        </div>
        <Link
          className="icon-button"
          href="/"
          aria-label="Trang giới thiệu"
          title="Trang giới thiệu"
        >
          <House size={19} />
        </Link>
        <button
          className="icon-button"
          title="Đăng xuất"
          aria-label="Đăng xuất"
          onClick={() => {
            void auth
              .logout()
              .then(() => {
                router.replace("/login");
              })
              .catch(() => {
                window.alert("Không thể đăng xuất. Vui lòng thử lại.");
              });
          }}
        >
          <LogOut size={19} />
        </button>
      </header>
      <dialog
        className="mobile-management-nav"
        id="mobile-management-navigation"
        ref={mobileDialog}
        aria-labelledby="mobile-nav-title"
        onClose={() => setMobileOpen(false)}
        onCancel={() => setMobileOpen(false)}
      >
        <div className="panel-title">
          <h2 id="mobile-nav-title">Không gian quản lý</h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Đóng menu quản lý"
            onClick={() => setMobileOpen(false)}
          >
            <X size={20} />
          </button>
        </div>
        <div className="mobile-user">
          <strong>{auth.user.fullName}</strong>
          <span>{roleName}</span>
        </div>
        <nav aria-label="Điều hướng quản lý trên điện thoại">
          {renderGroups(() => setMobileOpen(false))}
        </nav>
        <Link
          className="button secondary"
          href="/"
          onClick={() => setMobileOpen(false)}
        >
          <House size={18} /> Trang giới thiệu
        </Link>
      </dialog>
      <div className="layout">
        <aside className="sidebar" id="main-navigation">
          <nav aria-label="Điều hướng chính">{renderGroups()}</nav>
          <div className="sidebar-footer">
            <Blocks size={22} />
            <div>
              <strong>Hyperledger Fabric</strong>
              <span>Dữ liệu truy xuất chuỗi khối</span>
            </div>
          </div>
        </aside>
        <main className="content" id="main-content">
          {!privateAccessReady && (
            <div
              className="notice"
              role={
                auth.privateAccessStatus === "unavailable" ? "alert" : "status"
              }
            >
              {auth.privateAccessStatus === "unavailable"
                ? "Chưa kiểm tra được quyền hiện hành. Dữ liệu riêng đang được ẩn."
                : "Đang kiểm tra quyền hiện hành…"}
              {auth.privateAccessStatus === "unavailable" && (
                <button
                  className="button secondary"
                  onClick={() =>
                    window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT))
                  }
                >
                  Kiểm tra lại
                </button>
              )}
            </div>
          )}
          <div
            className="page-content"
            key={`${authorizationScope}:${pathname}`}
            hidden={!privateAccessReady}
            style={privateAccessReady ? undefined : { display: "none" }}
          >
            <PendingCommandsPanel
              key={authorizationScope}
              onSettled={() => window.location.reload()}
            />
            {children}
          </div>
          <footer className="footer">
            <span>AgriTrace</span>
            <span>Nguồn gốc rõ ràng. Hành trình minh bạch.</span>
          </footer>
        </main>
      </div>
      <nav className="bottom-nav" aria-label="Điều hướng nhanh">
        {allowed.slice(0, 4).map(({ href, label, icon: Icon }) => (
          <Link
            href={href}
            key={href}
            aria-current={isActive(pathname, href) ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{label.split(",")[0]}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-label="Mở thêm điều hướng"
          onClick={() => setMobileOpen(true)}
        >
          <Ellipsis size={20} />
          <span>Thêm</span>
        </button>
      </nav>
    </div>
  );
}
