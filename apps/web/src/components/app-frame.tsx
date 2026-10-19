"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SiteFooter, ZaloFloat } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useAuth } from "@/lib/auth-store";
import { canAccessManagementRoute, platformAdminHome } from "@/lib/permissions";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { canUseEnterpriseRoute } from "@/lib/enterprise-access";
import {
  homeRoute,
  isActiveRoute,
  mobileShortcuts,
  routeContext,
  visibleAccountLinks,
  visibleGroups,
  type RouteViewer,
} from "@/lib/management-routes";
import { PendingCommandsPanel } from "./pending-commands-panel";
import { AccountMenu } from "./shell/account-menu";
import { BackButton } from "./shell/back-button";
import { FieldFocus } from "./shell/field-focus";
import { TypographySync } from "./shell/typography-sync";
import { NotificationsMenu } from "./shell/notifications-menu";
import { MenuSearch } from "./shell/menu-search";
import { NavGroups } from "./shell/nav-groups";
import {
  useEnterpriseAccess,
  usePendingTaskCount,
} from "./shell/use-shell-data";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/join-organization" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/scan" ||
    pathname.startsWith("/trace/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const mobileDialog = useRef<HTMLDialogElement>(null);
  const authorizationScope = getAuthorizationScope(auth.user);
  const privateAccessReady =
    !auth.privateAccessStatus || auth.privateAccessStatus === "ready";
  const enterpriseUser =
    !!auth.user?.organizationId &&
    ![
      "SYSTEM_ADMIN",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
      "IOT_DEVICE",
      "SYSTEM_ACTOR",
    ].includes(auth.user.role.code);
  const enterprise = useEnterpriseAccess({
    enabled: enterpriseUser && !isPublic && auth.isAuthenticated,
    scope: authorizationScope,
  });
  const access = enterprise.access;
  const mayReadTasks =
    !isPublic && !!access && canUseEnterpriseRoute("/enterprise/inbox", access);
  const pendingTasks = usePendingTaskCount({
    enabled: mayReadTasks,
    scope: authorizationScope,
    pathname,
    revision: enterprise.revision,
  });
  useEffect(() => {
    if (
      !enterpriseUser ||
      !access ||
      ["ACTIVE", "ACTIVE_LEGACY"].includes(access.stage) ||
      pathname.startsWith("/enterprise/onboarding") ||
      pathname.startsWith("/enterprise/service")
    )
      return;
    router.replace(
      ["PENDING_REVIEW", "REJECTED"].includes(access.stage)
        ? "/enterprise/onboarding"
        : "/enterprise/service",
    );
  }, [access, enterpriseUser, pathname, router]);
  useEffect(() => {
    // A temporary password only opens the page that replaces it.
    if (
      auth.user?.mustChangePassword &&
      !isPublic &&
      pathname !== "/account/password"
    )
      router.replace("/account/password");
  }, [auth.user?.mustChangePassword, isPublic, pathname, router]);
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
  if (enterpriseUser && !access)
    return (
      <main className="public-content">
        <p
          className={enterprise.error ? "notice error" : "loading-state"}
          role={enterprise.error ? "alert" : "status"}
        >
          {enterprise.error
            ? "Chưa kiểm tra được quyền hiện tại."
            : "Đang tải quyền hiện tại…"}
        </p>
        {enterprise.error && (
          <button className="button secondary" onClick={enterprise.retry}>
            Kiểm tra lại
          </button>
        )}
      </main>
    );
  if (
    enterpriseUser &&
    access &&
    !["ACTIVE", "ACTIVE_LEGACY"].includes(access.stage) &&
    !pathname.startsWith("/enterprise/onboarding") &&
    !pathname.startsWith("/enterprise/service")
  )
    return (
      <main className="public-content">
        <p className="notice">
          {access.stage === "PENDING_REVIEW"
            ? "Hồ sơ đang chờ admin duyệt."
            : "Hoàn thiện dịch vụ để kích hoạt không gian doanh nghiệp."}
        </p>
        <Link
          className="button"
          href={
            access.stage === "PENDING_REVIEW" || access.stage === "REJECTED"
              ? "/enterprise/onboarding"
              : "/enterprise/service"
          }
        >
          Theo dõi và hoàn thiện hồ sơ
        </Link>
      </main>
    );
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
  if (enterpriseUser && access && !canUseEnterpriseRoute(pathname, access))
    return (
      <main className="public-content">
        <p className="notice error" role="alert">
          Bạn chưa được cấp quyền sử dụng chức năng này.
        </p>
        <Link className="button secondary" href="/enterprise">
          Về doanh nghiệp
        </Link>
      </main>
    );
  const roleName =
    enterpriseUser && access
      ? access.primary
        ? "Quản trị doanh nghiệp · Cấp 1"
        : access.tier === 2
          ? "Quản lý được ủy quyền · Cấp 2"
          : access.tier === 3
            ? "Nhân viên · Cấp 3"
            : auth.user.role.name || role
      : auth.user.role.name || role;
  const viewer: RouteViewer = {
    role,
    productionAccess: auth.user.productionAccess,
    enterpriseAccess: access,
    enterpriseUser,
  };
  const groups = visibleGroups(viewer);
  const shortcuts = mobileShortcuts(groups);
  const home = homeRoute(role, enterpriseUser);
  const platform = !!platformAdminHome(role);
  const context = routeContext(pathname);
  const logout = () => {
    void auth
      .logout()
      .then(() => {
        router.replace("/login");
      })
      .catch(() => {
        window.alert("Không thể đăng xuất. Vui lòng thử lại.");
      });
  };

  return (
    <div
      className="app-shell"
      data-mobile-open={mobileOpen}
      data-surface={platform ? "admin" : undefined}
    >
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
          {mobileOpen ? "Đóng" : "Menu"}
        </button>
        <Link className="brand" href={home} aria-label="AgriTrace - Tổng quan">
          <BrandLogo height={40} priority />
        </Link>
        <nav className="workspace-context" aria-label="Vị trí hiện tại">
          <strong>
            {platform ? "Quản trị nền tảng" : "Không gian doanh nghiệp"}
          </strong>
          {context && (
            <>
              <span aria-hidden="true">/</span>
              <span>{context.group.title}</span>
              <span aria-hidden="true">/</span>
              <Link
                href={context.item.href}
                aria-current={
                  pathname === context.item.href ? "page" : undefined
                }
              >
                {context.item.label}
              </Link>
            </>
          )}
        </nav>
        <div className="topbar-search">
          <MenuSearch groups={groups} extra={visibleAccountLinks(viewer)} />
        </div>
        <div className="topbar-actions">
          <Link
            className="icon-button"
            href="/scan"
            aria-label="Quét mã QR"
            title="Quét mã QR"
          >
            Quét QR
          </Link>
          <Link
            className="icon-button"
            href="/"
            aria-label="Trang giới thiệu"
            title="Trang giới thiệu"
          >
            Trang chủ
          </Link>
          <NotificationsMenu
            enabled={mayReadTasks}
            scope={authorizationScope}
            pathname={pathname}
          />
          <AccountMenu
            fullName={auth.user.fullName}
            roleName={roleName}
            links={visibleAccountLinks(viewer)}
            pathname={pathname}
            onLogout={logout}
          />
        </div>
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
          <h2 id="mobile-nav-title">
            {platform ? "Quản trị nền tảng" : "Không gian quản lý"}
          </h2>
          <button
            className="icon-button"
            type="button"
            aria-label="Đóng menu quản lý"
            onClick={() => setMobileOpen(false)}
          >
            Đóng
          </button>
        </div>
        <div className="mobile-user">
          <strong>{auth.user.fullName}</strong>
          <span>{roleName}</span>
        </div>
        <nav aria-label="Điều hướng quản lý trên điện thoại">
          <NavGroups
            groups={groups}
            pathname={pathname}
            pendingTasks={pendingTasks}
            onNavigate={() => setMobileOpen(false)}
          />
        </nav>
        <Link
          className="button secondary"
          href="/"
          onClick={() => setMobileOpen(false)}
        >
           Trang giới thiệu
        </Link>
      </dialog>
      <div className="layout">
        <aside className="sidebar" id="main-navigation">
          <Link className="sidebar-brand" href={home} aria-label="AgriTrace">
            <Image
              className="sidebar-brand-logo"
              src="/agritrace/brand/agritrace-logo-on-dark.png"
              alt="AgriTrace — Truy xuất nguồn gốc nông sản Việt"
              width={720}
              height={212}
              priority
            />
            <small className="sidebar-brand-area">{platform ? "Quản trị nền tảng" : "Không gian doanh nghiệp"}</small>
          </Link>
          <nav aria-label="Điều hướng chính">
            <NavGroups
              groups={groups}
              pathname={pathname}
              pendingTasks={pendingTasks}
            />
          </nav>
          <div className="sidebar-identity">
            <span className="workspace-avatar" aria-hidden="true">
              {auth.user.fullName.slice(0, 2).toUpperCase()}
            </span>
            <span><strong>{auth.user.fullName}</strong><small>{roleName}</small></span>
          </div>
        </aside>
        <main className="content" id="main-content">
          <FieldFocus />
          <TypographySync />
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
            key={`${authorizationScope}:${pathname.startsWith("/enterprise/service") ? "/enterprise/service" : pathname}`}
            hidden={!privateAccessReady}
            style={privateAccessReady ? undefined : { display: "none" }}
          >
            <BackButton pathname={pathname} home={home} />
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
        {shortcuts.map(({ href, label }) => (
          <Link
            href={href}
            key={href}
            aria-current={isActiveRoute(pathname, href) ? "page" : undefined}
          >
            <span>{label.split(",")[0]}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-label="Mở thêm điều hướng"
          onClick={() => setMobileOpen(true)}
        >
          <span>Thêm</span>
        </button>
      </nav>
    </div>
  );
}
