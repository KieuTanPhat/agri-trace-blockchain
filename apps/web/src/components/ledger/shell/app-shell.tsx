"use client";
import { LedgerRecoveryPanel } from "../command-recovery";
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, LogOut, Menu, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import { canAccessManagementRoute, platformAdminHome } from "@/lib/permissions";
import {
  canUseEnterpriseRoute,
  enterpriseLanding,
  type EnterpriseAccess,
} from "@/lib/enterprise-access";
import { ledgerQueryKey } from "@/lib/ledger/query-scope";
import {
  PLATFORM_NAV,
  WORKSPACE_NAV,
  canonicalNavigationUrls,
} from "@/lib/ledger/navigation";
import { t } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";
import { AgritraceLogo } from "../brand";
import { LanguageSwitch, useLocale } from "../locale";
import { useLedgerConfirm } from "../confirm-provider";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { useNotificationFeed } from "@/lib/ledger/notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import { ErrorState } from "../kit/page";
import { SidebarNav } from "./sidebar";
import { CommandPalette } from "./command-palette";

const THEME_EVENT = "agt-admin-theme";
const subscribeTheme = (listener: () => void) => {
  window.addEventListener(THEME_EVENT, listener);
  return () => window.removeEventListener(THEME_EVENT, listener);
};
function useLedgerDarkTheme() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  const setDark = (next: boolean) => {
    document.documentElement.classList.toggle("dark", next);
    window.dispatchEvent(new Event(THEME_EVENT));
    try {
      localStorage.setItem("agt-admin.theme", next ? "dark" : "light");
    } catch {
      /* Optional storage. */
    }
  };
  return [dark, setDark] as const;
}
export function LedgerThemeToggle() {
  const [dark, setDark] = useLedgerDarkTheme();
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <Moon className="size-4 text-ink-2" aria-hidden />
      {t("Giao diện tối")}
      <Switch checked={dark} onCheckedChange={setDark} />
    </label>
  );
}
function ThemeMenuItem() {
  const [dark, setDark] = useLedgerDarkTheme();
  return (
    <DropdownMenuItem
      onSelect={(event) => {
        event.preventDefault();
        setDark(!dark);
      }}
    >
      {dark ? <Moon /> : <Sun />}
      <span className="flex-1">{t("Giao diện tối")}</span>
      <Switch
        checked={dark}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none"
      />
    </DropdownMenuItem>
  );
}
function NotificationBell({
  enterprise,
  permissions,
  inbox,
  href,
}: {
  enterprise: boolean;
  permissions: string[];
  inbox: boolean;
  href: string;
}) {
  const { count } = useNotificationFeed(
    enterprise ? { kind: "enterprise", permissions } : { kind: "platform", inbox },
  );
  return (
    <Button
      asChild
      variant="ghost"
      size="icon-sm"
      className="relative"
    >
      <Link
        href={href}
        aria-label={
          count ? t("Thông báo ({p0} mới)", { p0: count }) : t("Thông báo")
        }
      >
        <Bell />
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 font-mono text-[10px] leading-none font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </Button>
  );
}
const ShellMounted = createContext(false);
/** Route layouts mount the shell once so navigation keeps the sidebar, its
 * scroll position and loaded access state; screens inside it render bare. */
export function LedgerAppShell({ children }: { children: React.ReactNode }) {
  if (useContext(ShellMounted)) return children;
  return (
    <ShellMounted.Provider value>
      <ShellFrame>{children}</ShellFrame>
    </ShellMounted.Provider>
  );
}
function ShellFrame({ children }: { children: React.ReactNode }) {
  useLocale();
  const { user, isLoading, privateAccessStatus, logout } = useAuth();
  const pathname = usePathname(),
    router = useRouter(),
    confirm = useLedgerConfirm();
  const navTrigger=useRef<HTMLButtonElement>(null);
  const [navOpen, setNavOpen] = useState(false),
    [palette, setPalette] = useState(false);
  const enterprise =
    !!user?.organizationId &&
    ![
      "SYSTEM_ADMIN",
      "PLATFORM_OPERATOR",
      "PLATFORM_CASE_MANAGER",
      "PLATFORM_PRIVACY_OFFICER",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
      "IOT_DEVICE",
      "SYSTEM_ACTOR",
    ].includes(user?.role.code ?? "");
  const access = useQuery({
    queryKey: ledgerQueryKey(user, ["enterprise-access"]),
    queryFn: () => request<EnterpriseAccess>("/enterprise-access"),
    enabled:
      enterprise &&
      privateAccessStatus === "ready" &&
      !user?.mustChangePassword,
  });
  const overview = useQuery({
    queryKey: ledgerQueryKey(user, ["enterprise-overview"]),
    queryFn: () =>
      request<
        Pick<components["schemas"]["WorkspaceOverviewDto"], "organization">
      >("/enterprise-workspace"),
    enabled:
      enterprise &&
      !user?.mustChangePassword &&
      privateAccessStatus === "ready" &&
      !!access.data &&
      canUseEnterpriseRoute("/enterprise", access.data),
  });
  useEffect(() => {
    if (!isLoading && !user)
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (user?.mustChangePassword && pathname !== "/account/password")
      router.replace("/account/password");
  }, [user, isLoading, pathname, router]);
  // A page this enterprise account cannot open (a stale ?next= after sign-in,
  // or a service not yet active) leads to its own landing page instead.
  const landing = access.data ? enterpriseLanding(access.data) : null;
  const blocked =
    enterprise &&
    !!access.data &&
    !pathname.startsWith("/account/") &&
    !canUseEnterpriseRoute(pathname, access.data);
  useEffect(() => {
    if (blocked && landing && landing !== pathname) router.replace(landing);
  }, [blocked, landing, pathname, router]);
  if (
    isLoading ||
    !user ||
    (user.mustChangePassword && pathname !== "/account/password")
  )
    return (
      <div className="grid min-h-dvh place-items-center text-[13px] text-ink-2">
        {t("Đang kiểm tra phiên đăng nhập…")}
      </div>
    );
  // The outer auth gate hides/inerts an admitted tree during rechecks. Keep its
  // mounted drafts while that gate waits for the same account's permission reply.
  const account = pathname.startsWith("/account/");
  if (!account && enterprise && access.isPending)
    return (
      <div
        aria-busy="true"
        className="grid min-h-dvh place-items-center text-ink-2"
      >
        {t("Đang tải")}
      </div>
    );
  if (!account && enterprise && access.isError)
    return (
      <ErrorState error={access.error} onRetry={() => void access.refetch()} />
    );
  const allowed = (path: string) =>
    canAccessManagementRoute(path, user.role.code, user.productionAccess) &&
    (!enterprise ||
      (!!access.data && canUseEnterpriseRoute(path, access.data)));
  const groups = (enterprise ? WORKSPACE_NAV : PLATFORM_NAV)
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) => canonicalNavigationUrls.has(item.href) && allowed(item.href),
      ),
    }))
    .filter((group) => group.items.length);
  if (!account && !allowed(pathname))
    return (
      <div
        role="alert"
        className="grid min-h-dvh place-items-center px-6 text-center"
      >
        <div>
          <h1 className="text-[18px] font-semibold">
            {t("Không có quyền truy cập")}
          </h1>
          <Link
            className="text-brand hover:underline"
            href={platformAdminHome(user.role.code) ?? landing ?? "/"}
          >
            {t("Về trang đầu")}
          </Link>
        </div>
      </div>
    );
  const notificationsHref = enterprise
    ? "/enterprise/notifications"
    : "/admin/notifications";
  const brand = enterprise ? (
    <div className="flex flex-col gap-2 border-b border-line px-5 pt-4 pb-3">
      <Link href="/enterprise" aria-label="AgriTrace">
        <AgritraceLogo height={28} priority />
      </Link>
      <div className="flex flex-col">
        <span
          className="truncate text-[13px] font-semibold"
          title={overview.data?.organization.name}
        >
          {overview.data?.organization.name ?? t("Doanh nghiệp")}
        </span>
        <span className="text-[11.5px] text-ink-2">
          {access.data?.tier
            ? t("Cấp {p0}", { p0: access.data.tier })
            : user.role.name}
        </span>
      </div>
    </div>
  ) : (
    <Link
      href={platformAdminHome(user.role.code) ?? "/dashboard"}
      className="flex flex-col items-start gap-1 px-5 pt-4 pb-3"
      aria-label="AgriTrace"
    >
      <AgritraceLogo height={30} priority />
      <span className="text-[10.5px] font-semibold tracking-[0.12em] text-ink-2 uppercase">
        {t("Quản trị nền tảng")}
      </span>
    </Link>
  );
  return (
    <div data-testid="ledger-private-root" className="flex min-h-dvh">
      <aside
        className={cn(
          "sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r border-line bg-card lg:flex",
          enterprise ? "w-[248px]" : "w-[240px]",
        )}
      >
        {brand}
        <SidebarNav groups={groups} />
      </aside>
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetContent side="left" className="w-[280px] overflow-y-auto p-0" onCloseAutoFocus={event=>{event.preventDefault();navTrigger.current?.focus();}}>
          <SheetTitle className="sr-only">{t("Điều hướng")}</SheetTitle>
          {brand}
          <SidebarNav groups={groups} onNavigate={() => setNavOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-[52px] items-center gap-2 border-b border-line bg-card/95 px-3 backdrop-blur sm:px-5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="lg:hidden"
            ref={navTrigger}
            aria-label={t("Mở điều hướng")}
            onClick={() => setNavOpen(true)}
          >
            <Menu />
          </Button>
          {enterprise ? (
            <span className="text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
              {t("Không gian doanh nghiệp")}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setPalette(true)}
              className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-left text-[13px] text-ink-2 hover:border-line-strong sm:max-w-[420px]"
            >
              <Search className="size-3.5 shrink-0" />
              <span className="truncate">
                {t("Tìm trang, tổ chức, mã lô…")}
              </span>
              <kbd className="ml-auto hidden rounded border border-line bg-card px-1.5 font-mono text-[10.5px] sm:inline">
                Ctrl K
              </kbd>
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitch />
            {allowed(notificationsHref) && (
              <NotificationBell
                enterprise={enterprise}
                permissions={access.data?.permissions ?? []}
                inbox={allowed("/admin/inbox")}
                href={notificationsHref}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t("Tài khoản")}
                  className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sunken"
                >
                  <span className="hidden flex-col items-end leading-tight md:flex">
                    <span className="text-[13px] font-medium">
                      {user.fullName}
                    </span>
                    <span className="text-[11px] text-ink-2">
                      {user.role.name}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="inline-flex size-7 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold"
                  >
                    {user.fullName.split(" ").pop()?.[0]}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex flex-col gap-0.5">
                  <span>{user.fullName}</span>
                  <span className="font-mono text-[11px] font-normal text-ink-2">
                    {user.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account/password">
                    <ShieldCheck />
                    {t("Đổi mật khẩu")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/account/privacy">
                    {t("Quyền dữ liệu cá nhân")}
                  </Link>
                </DropdownMenuItem>
                <ThemeMenuItem />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={async () => {
                    if (
                      await confirm({
                        title: t("Đăng xuất"),
                        confirmLabel: t("Đăng xuất"),
                      })
                    ) {
                      await logout();
                      router.replace("/login");
                    }
                  }}
                >
                  <LogOut />
                  {t("Đăng xuất")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main className="flex min-w-0 flex-1 flex-col">
          <LedgerRecoveryPanel />
          {children}
        </main>
      </div>
      <CommandPalette
        open={palette}
        onOpenChange={setPalette}
        groups={groups}
      />
    </div>
  );
}
