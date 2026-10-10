"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  X,
  LayoutDashboard,
  Package,
  ScanLine,
  Thermometer,
  Blocks,
  Search,
  Home,
  LogOut,
} from "lucide-react";
import { PublicHeader } from "./landing-navigation";
import { getLots } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { LotTrace } from "@/lib/types";
import { canAccessManagementRoute } from "@/lib/permissions";
import { getAuthorizationScope } from "@/lib/auth-scope";

const navigation = [
  { href: "/dashboard", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/admin", label: "Quản trị", icon: Blocks },
  { href: "/production-cycles", label: "Vụ trồng", icon: LayoutDashboard },
  { href: "/lots", label: "Lô nông sản", icon: Package },
  { href: "/compliance", label: "Kiểm định, chứng nhận", icon: Blocks },
  { href: "/scan", label: "Quét mã QR", icon: ScanLine },
  { href: "/iot-simulator", label: "Cảm biến IoT", icon: Thermometer },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/scan" ||
    pathname.startsWith("/trace/");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState("");
  const authorizationScope = getAuthorizationScope(auth.user);
  const [searchData, setSearchData] = useState<{
    scope?: string;
    lots: LotTrace[];
  }>({ lots: [] });
  const lots = searchData.scope === authorizationScope ? searchData.lots : [];
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
        <PublicHeader />
        <main className="public-content" id="main-content">
          {children}
        </main>
      </div>
    );
  if (auth.isLoading || !auth.isAuthenticated || !auth.user)
    return (
      <main className="public-content">
        <div className="loading-state">Đang kiểm tra phiên đăng nhập...</div>
      </main>
    );

  const role = auth.user.role.code;
  if (!canAccessManagementRoute(pathname, role))
    return (
      <main className="public-content">
        <div className="notice error" role="alert">
          Bạn không có quyền sử dụng chức năng này.
        </div>
        <Link href="/dashboard">Về tổng quan</Link>
      </main>
    );
  const roleName = auth.user.role.name || auth.user.role.code;
  return (
    <div
      className="app-shell"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      <a className="app-skip-link" href="#main-content">
        Đi đến nội dung
      </a>
      <header className="topbar">
        <Link
          className="brand"
          href="/dashboard"
          aria-label="AgriTrace - Tổng quan"
        >
          <Image
            className="brand-logo"
            src="/agritrace/brand/agritrace-logo.svg"
            alt="AgriTrace"
            width={260}
            height={72}
            priority
          />
          <span className="brand-text">
            <span className="brand-sub">Truy xuất nguồn gốc nông sản</span>
          </span>
        </Link>
        <div className="header-search">
          <Search size={20} />
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
              {lots
                .filter((lot) =>
                  `${lot.productName} ${lot.lotCode} ${lot.farmOrg.name}`
                    .toLocaleLowerCase("vi")
                    .includes(query.trim().toLocaleLowerCase("vi")),
                )
                .map((lot) => (
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
                !lots.some((lot) =>
                  `${lot.productName} ${lot.lotCode} ${lot.farmOrg.name}`
                    .toLocaleLowerCase("vi")
                    .includes(query.trim().toLocaleLowerCase("vi")),
                ) && <p>Không tìm thấy lô phù hợp.</p>
              )}
            </div>
          )}
        </div>
        <Link
          className="icon-button home-link"
          href="/"
          aria-label="Trang giới thiệu"
          title="Trang giới thiệu"
        >
          <Home size={19} />
        </Link>
        <div className="topbar-meta">
          <span className="workspace-avatar">
            {auth.user.fullName.slice(0, 2).toUpperCase()}
          </span>
          <span>
            {auth.user.fullName}
            <small>{roleName}</small>
          </span>
        </div>
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
        <button
          className="icon-button desktop-toggle"
          title={collapsed ? "Mở rộng điều hướng" : "Thu gọn điều hướng"}
          aria-label={collapsed ? "Mở rộng điều hướng" : "Thu gọn điều hướng"}
          aria-expanded={!collapsed}
          aria-controls="main-navigation"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? (
            <PanelLeftOpen size={21} />
          ) : (
            <PanelLeftClose size={21} />
          )}
        </button>
        <button
          className="icon-button mobile-toggle"
          title="Điều hướng"
          aria-label={mobileOpen ? "Đóng điều hướng" : "Mở điều hướng"}
          aria-expanded={mobileOpen}
          aria-controls="mobile-management-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={21} /> : <PanelLeftOpen size={21} />}
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
        <nav
          className="nav-list"
          aria-label="Điều hướng quản lý trên điện thoại"
        >
          {navigation
            .filter(({ href }) => canAccessManagementRoute(href, role))
            .map(({ href, label, icon: Icon }) => (
              <Link
                className="nav-link"
                href={href}
                key={href}
                aria-current={
                  pathname === href || pathname.startsWith(href + "/")
                    ? "page"
                    : undefined
                }
                onClick={() => setMobileOpen(false)}
              >
                <Icon size={21} />
                <span>{label}</span>
              </Link>
            ))}
        </nav>
        <Link
          className="button secondary"
          href="/"
          onClick={() => setMobileOpen(false)}
        >
          <Home size={18} /> Trang giới thiệu
        </Link>
      </dialog>
      <div className="layout">
        <aside className="sidebar" id="main-navigation">
          <p className="sidebar-heading">Không gian quản lý</p>
          <nav className="nav-list" aria-label="Điều hướng chính">
            {navigation
              .filter(({ href }) => canAccessManagementRoute(href, role))
              .map(({ href, label, icon: Icon }) => {
                const active =
                  href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(
                        href.split("/").slice(0, 2).join("/"),
                      );
                return (
                  <Link
                    className="nav-link"
                    href={href}
                    key={href}
                    title={label}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMobileOpen(false)}
                  >
                    <Icon size={21} />
                    <span>{label}</span>
                  </Link>
                );
              })}
          </nav>
          <div className="sidebar-garden">
            <Image
              src="/farm-landscape.png"
              alt=""
              className="sidebar-garden-photo"
              fill
              sizes="260px"
            />
            <p className="sidebar-garden-caption">
              Nông sản minh bạch
              <br />
              Giá trị bền vững
            </p>
          </div>
          <div className="sidebar-network">
            <Blocks size={22} />
            <div>
              <strong>Hyperledger Fabric</strong>
              <span>Dữ liệu truy xuất chuỗi khối</span>
            </div>
          </div>
        </aside>
        <main className="content" id="main-content">
          <div
            className="page-content"
            key={`${authorizationScope}:${pathname}`}
          >
            {children}
          </div>
          <footer className="footer">
            <span>AgriTrace</span>
            <span>Nguồn gốc rõ ràng. Hành trình minh bạch.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
