"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { SiteFooter, ZaloFloat } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { useAuth } from "@/lib/auth-store";
import { useConfirm } from "@/lib/confirm";
import { canAccessManagementRoute, platformAdminHome } from "@/lib/permissions";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { canUseEnterpriseRoute } from "@/lib/enterprise-access";
import {
  homeRoute,
  isEnterpriseUser,
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
import { SystemNotices } from "./shell/system-notices";
import { WorkspaceSidebar } from "./shell/workspace-sidebar";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "./ui/sidebar";
import { Separator } from "./ui/separator";
import { ThemeToggle } from "./shell/theme-provider";
import {
  useEnterpriseAccess,
  usePendingTaskCount,
} from "./shell/use-shell-data";

export function AppFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const confirm = useConfirm();
  const isPublic =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/join-organization" ||
    pathname === "/terms" ||
    pathname === "/privacy" ||
    pathname === "/scan" ||
    pathname.startsWith("/trace/");
  const authorizationScope = getAuthorizationScope(auth.user);
  const privateAccessReady =
    !auth.privateAccessStatus || auth.privateAccessStatus === "ready";
  const enterpriseUser = isEnterpriseUser(auth.user);
  // The API rejects everything but the password change while one is forced.
  const forcedPassword = !!auth.user?.mustChangePassword;
  const enterprise = useEnterpriseAccess({
    enabled:
      enterpriseUser && !isPublic && auth.isAuthenticated && !forcedPassword,
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
  if (forcedPassword)
    return (
      <main className="public-content" id="main-content">
        {pathname === "/account/password" ? (
          children
        ) : (
          <div className="loading-state">Đang chuyển tới trang đổi mật khẩu…</div>
        )}
      </main>
    );
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
        <Link className="text-link" href={homeRoute(role, enterpriseUser)}>
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
  const home = homeRoute(role, enterpriseUser);
  const platform = !!platformAdminHome(role);
  const context = routeContext(pathname);
  const logout = async () => {
    if (
      !(await confirm(
        "Đăng xuất khỏi AgriTrace trên thiết bị này?",
        "Xác nhận đăng xuất",
      ))
    )
      return;
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
    <SidebarProvider className="app-shell shadcn-workspace" data-surface={platform ? "admin" : "enterprise"}>
      <a className="skip-link" href="#main-content">Đi đến nội dung</a>
      <WorkspaceSidebar groups={groups} pathname={pathname} home={home} platform={platform} pendingTasks={pendingTasks} fullName={auth.user.fullName} roleName={roleName} />
      <SidebarInset>
        <header className="workspace-header">
          <SidebarTrigger aria-label="Đóng/mở điều hướng" />
          <Separator orientation="vertical" className="h-4" />
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

          <div className="workspace-header-search"><MenuSearch groups={groups} extra={visibleAccountLinks(viewer)} /></div>
          <div className="workspace-header-actions">
            <ThemeToggle />
            <NotificationsMenu enabled={mayReadTasks} scope={authorizationScope} pathname={pathname} />
            <AccountMenu fullName={auth.user.fullName} roleName={roleName} links={visibleAccountLinks(viewer)} pathname={pathname} onLogout={logout} />
          </div>
        </header>
        <main className="workspace-main" id="main-content">
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
            <SystemNotices scope={authorizationScope} />
            <PendingCommandsPanel
              key={authorizationScope}
              onSettled={() => window.location.reload()}
            />
            {children}
          </div>

        </main>
        <footer className="workspace-footer"><span>AgriTrace</span><span>Nguồn gốc rõ ràng. Hành trình minh bạch.</span></footer>
      </SidebarInset>
    </SidebarProvider>
  );
}
