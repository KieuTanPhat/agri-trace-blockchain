"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  Bell,
  LogOut,
} from "lucide-react";
import { getLots } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import type { LotTrace } from "@/lib/types";

const navigation = [
  { href: "/", label: "Tổng quan", icon: LayoutDashboard },
  { href: "/lots", label: "Lô nông sản", icon: Package },
  { href: "/scan", label: "Quét mã QR", icon: ScanLine },
  { href: "/iot-simulator", label: "Cảm biến IoT", icon: Thermometer },
];

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isPublic =
    pathname === "/login" ||
    pathname === "/scan" ||
    pathname.startsWith("/trace/");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lots, setLots] = useState<LotTrace[]>([]);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    if (!auth.isAuthenticated) return;
    getLots()
      .then(setLots)
      .catch(() => setSearchFailed(true));
  }, [auth.isAuthenticated]);
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !isPublic)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [auth.isAuthenticated, auth.isLoading, isPublic, pathname, router]);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  if (isPublic) return <main className="public-content">{children}</main>;
  if (auth.isLoading || !auth.isAuthenticated || !auth.user)
    return (
      <main className="public-content">
        <div className="loading-state">Đang kiểm tra phiên đăng nhập...</div>
      </main>
    );

  const roleName = auth.user.role.name || auth.user.role.code;
  return (
    <div
      className="app-shell"
      data-collapsed={collapsed}
      data-mobile-open={mobileOpen}
    >
      <header className="topbar">
        <Link className="brand" href="/" aria-label="AgriTrace - Tổng quan">
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
        <button
          className="icon-button notification-btn"
          title="Thông báo"
          aria-label="Thông báo"
        >
          <Bell size={20} />
          <span className="notification-dot" aria-hidden="true" />
        </button>
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
            auth.logout();
            router.replace("/login");
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
          aria-controls="main-navigation"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={21} /> : <PanelLeftOpen size={21} />}
        </button>
      </header>
      <div className="layout">
        {mobileOpen && (
          <button
            className="nav-backdrop"
            aria-label="Đóng điều hướng"
            onClick={() => setMobileOpen(false)}
          />
        )}
        <aside className="sidebar" id="main-navigation">
          <p className="sidebar-heading">Không gian quản lý</p>
          <nav className="nav-list" aria-label="Điều hướng chính">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active =
                href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(href.split("/").slice(0, 2).join("/"));
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
        <main className="content">
          <div className="page-content" key={pathname}>
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
