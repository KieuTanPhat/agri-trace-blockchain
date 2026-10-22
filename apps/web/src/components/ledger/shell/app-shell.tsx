"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LogOut, Menu, Moon, Search, ShieldCheck, Sun } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import { canAccessManagementRoute, platformAdminHome } from "@/lib/permissions";
import { canUseEnterpriseRoute, type EnterpriseAccess } from "@/lib/enterprise-access";
import { ledgerQueryKey } from "@/lib/ledger/query-scope";
import { PLATFORM_NAV, WORKSPACE_NAV, canonicalNavigationUrls } from "@/lib/ledger/navigation";
import { t } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";
import { AgritraceLogo } from "../brand";
import { LanguageSwitch, useLocale } from "../locale";
import { useLedgerConfirm } from "../confirm-provider";
import { Button } from "../ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "../ui/sheet";
import { ErrorState } from "../kit/page";
import { SidebarNav } from "./sidebar";
import { CommandPalette } from "./command-palette";

const THEME_EVENT = "agt-admin-theme";
const subscribeTheme = (listener: () => void) => { window.addEventListener(THEME_EVENT, listener); return () => window.removeEventListener(THEME_EVENT, listener); };
export function LedgerThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.classList.contains("dark"), () => false);
  return <Button variant="ghost" size="icon-sm" aria-label={dark ? t("Giao diện sáng") : t("Giao diện tối")} onClick={() => { document.documentElement.classList.toggle("dark", !dark); window.dispatchEvent(new Event(THEME_EVENT)); try { localStorage.setItem("agt-admin.theme", dark ? "light" : "dark"); } catch { /* Optional storage. */ } }}>{dark ? <Sun /> : <Moon />}</Button>;
}
export function LedgerAppShell({ children }: { children: React.ReactNode }) {
  useLocale();
  const { user, isLoading, privateAccessStatus, logout } = useAuth();
  const pathname = usePathname(), router = useRouter(), confirm = useLedgerConfirm();
  const [navOpen, setNavOpen] = useState(false), [palette, setPalette] = useState(false);
  const enterprise = !!user?.organizationId && !["SYSTEM_ADMIN", "PLATFORM_OPERATOR", "PLATFORM_CASE_MANAGER", "PLATFORM_PRIVACY_OFFICER", "AUDITOR", "COMPLIANCE_REVIEWER", "IOT_DEVICE", "SYSTEM_ACTOR"].includes(user?.role.code ?? "");
  const access = useQuery({ queryKey: ledgerQueryKey(user, ["enterprise-access"]), queryFn: () => request<EnterpriseAccess>("/enterprise-access"), enabled: enterprise && privateAccessStatus === "ready" && !user?.mustChangePassword });
  const overview = useQuery({ queryKey: ledgerQueryKey(user, ["enterprise-overview"]), queryFn: () => request<Pick<components["schemas"]["WorkspaceOverviewDto"], "organization">>("/enterprise-workspace"), enabled: enterprise && !user?.mustChangePassword && privateAccessStatus === "ready" && !!access.data && canUseEnterpriseRoute("/enterprise", access.data) });
  useEffect(() => {
    if (!isLoading && !user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    if (user?.mustChangePassword && pathname !== "/account/password") router.replace("/account/password");
  }, [user, isLoading, pathname, router]);
  if (isLoading || !user || (user.mustChangePassword && pathname !== "/account/password")) return <div className="grid min-h-dvh place-items-center text-[13px] text-ink-2">{t("Đang kiểm tra phiên đăng nhập…")}</div>;
  if (!user.mustChangePassword && privateAccessStatus !== "ready") return <ErrorState error={{ status: 503, message: t("Chưa xác minh được quyền truy cập") }} onRetry={() => window.dispatchEvent(new Event("focus"))} />;
  const account = pathname.startsWith("/account/");
  if (!account && enterprise && access.isPending) return <div aria-busy="true" className="grid min-h-dvh place-items-center text-ink-2">{t("Đang tải")}</div>;
  if (!account && enterprise && access.isError) return <ErrorState error={access.error} onRetry={() => void access.refetch()} />;
  const allowed = (path: string) => canAccessManagementRoute(path, user.role.code, user.productionAccess) && (!enterprise || !!access.data && canUseEnterpriseRoute(path, access.data));
  const groups = (enterprise ? WORKSPACE_NAV : PLATFORM_NAV).map(group => ({ ...group, items: group.items.filter(item => canonicalNavigationUrls.has(item.href) && allowed(item.href)) })).filter(group => group.items.length);
  if (!account && !allowed(pathname)) return <div role="alert" className="grid min-h-dvh place-items-center px-6 text-center"><div><h1 className="text-[18px] font-semibold">{t("Không có quyền truy cập")}</h1><Link className="text-brand hover:underline" href={platformAdminHome(user.role.code) ?? "/enterprise"}>{t("Về trang đầu")}</Link></div></div>;
  const brand = enterprise ? <div className="flex flex-col gap-2 border-b border-line px-5 pt-4 pb-3"><Link href="/enterprise" aria-label="AgriTrace"><AgritraceLogo height={28} priority /></Link><div className="flex flex-col"><span className="truncate text-[13px] font-semibold" title={overview.data?.organization.name}>{overview.data?.organization.name ?? t("Doanh nghiệp")}</span><span className="text-[11.5px] text-ink-2">{access.data?.tier ? t("Cấp {p0}", { p0: access.data.tier }) : user.role.name}</span></div></div> : <Link href={platformAdminHome(user.role.code) ?? "/dashboard"} className="flex flex-col items-start gap-1 px-5 pt-4 pb-3" aria-label="AgriTrace"><AgritraceLogo height={30} priority /><span className="text-[10.5px] font-semibold tracking-[0.12em] text-ink-2 uppercase">{t("Quản trị nền tảng")}</span></Link>;
  return <div data-testid="ledger-private-root" className="flex min-h-dvh"><aside className={cn("sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r border-line bg-card lg:flex", enterprise ? "w-[248px]" : "w-[240px]")}>{brand}<SidebarNav groups={groups} /></aside><Sheet open={navOpen} onOpenChange={setNavOpen}><SheetContent side="left" className="w-[280px] overflow-y-auto p-0"><SheetTitle className="sr-only">{t("Điều hướng")}</SheetTitle>{brand}<SidebarNav groups={groups} onNavigate={() => setNavOpen(false)} /></SheetContent></Sheet><div className="flex min-w-0 flex-1 flex-col"><header className="sticky top-0 z-30 flex h-[52px] items-center gap-2 border-b border-line bg-card/95 px-3 backdrop-blur sm:px-5"><Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label={t("Mở điều hướng")} onClick={() => setNavOpen(true)}><Menu /></Button>{enterprise ? <span className="text-[12px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{t("Không gian doanh nghiệp")}</span> : <button type="button" onClick={() => setPalette(true)} className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-line bg-canvas px-2.5 text-left text-[13px] text-ink-2 hover:border-line-strong sm:max-w-[420px]"><Search className="size-3.5 shrink-0" /><span className="truncate">{t("Tìm trang, tổ chức, mã lô…")}</span><kbd className="ml-auto hidden rounded border border-line bg-card px-1.5 font-mono text-[10.5px] sm:inline">Ctrl K</kbd></button>}<div className="ml-auto flex items-center gap-2"><LanguageSwitch /><LedgerThemeToggle /><DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label={t("Tài khoản")} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sunken"><span className="hidden flex-col items-end leading-tight md:flex"><span className="text-[13px] font-medium">{user.fullName}</span><span className="text-[11px] text-ink-2">{user.role.name}</span></span><span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold">{user.fullName.split(" ").pop()?.[0]}</span></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuLabel className="flex flex-col gap-0.5"><span>{user.fullName}</span><span className="font-mono text-[11px] font-normal text-ink-2">{user.email}</span></DropdownMenuLabel><DropdownMenuSeparator /><DropdownMenuItem asChild><Link href="/account/password"><ShieldCheck />{t("Đổi mật khẩu")}</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href="/account/privacy">{t("Quyền dữ liệu cá nhân")}</Link></DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={async () => { if (await confirm({ title: t("Đăng xuất"), confirmLabel: t("Đăng xuất") })) { await logout(); router.replace("/login"); } }}><LogOut />{t("Đăng xuất")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></header><main className="flex min-w-0 flex-1 flex-col">{children}</main></div><CommandPalette open={palette} onOpenChange={setPalette} groups={groups} /></div>;
}
