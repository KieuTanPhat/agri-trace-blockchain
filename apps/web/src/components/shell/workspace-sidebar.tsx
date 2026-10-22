"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Building2, X, ChevronRight, ClipboardList, Factory, FileText, LayoutDashboard, LifeBuoy, Package, Settings2, ShieldCheck, Users, Wallet } from "lucide-react";
import { isActiveRoute, type NavGroup } from "@/lib/management-routes";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const routeIcon = (href: string) => {
  if (/members|users|roles|inspectors/.test(href)) return Users;
  if (/processing/.test(href)) return Factory;
  if (/enterprises|organizations|partners|sites/.test(href)) return Building2;
  if (/billing|service/.test(href)) return Wallet;
  if (/security|audit|compliance|approvals/.test(href)) return ShieldCheck;
  if (/products|inventory|lots|materials/.test(href)) return Package;
  if (/support|help/.test(href)) return LifeBuoy;
  if (/settings/.test(href)) return Settings2;
  if (/reports|profile|notices/.test(href)) return FileText;
  return href.split("/").length === 2 ? LayoutDashboard : ClipboardList;
};

/** Adapted from ShadcnStore v1.0.0 AppSidebar/NavMain; navigation stays permission-filtered. */
export function WorkspaceSidebar({ groups, pathname, home, platform, pendingTasks, fullName, roleName }: {
  groups: NavGroup[]; pathname: string; home: string; platform: boolean; pendingTasks: number; fullName: string; roleName: string;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  useEffect(() => { setOpenMobile(false); }, [pathname, setOpenMobile]);
  return <Sidebar collapsible="icon" variant="inset">
    <SidebarHeader>
      {isMobile && <Button variant="ghost" size="icon" className="ml-auto" aria-label="Đóng điều hướng" onClick={() => setOpenMobile(false)}><X size={18} /></Button>}
      <SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild>
        <Link href={home} aria-label="AgriTrace - Tổng quan">
          <span className="workspace-mark"><Factory className="size-5" /></span>
          <span className="grid min-w-0 flex-1 text-left"><strong>AgriTrace</strong><span className="text-xs text-muted-foreground">{platform ? "Quản trị nền tảng" : "Không gian doanh nghiệp"}</span></span>
        </Link>
      </SidebarMenuButton></SidebarMenuItem></SidebarMenu>
    </SidebarHeader>
    <SidebarContent><nav aria-label="Điều hướng chính">{groups.map(group => <SidebarGroup key={group.title}>
      <SidebarGroupLabel>{group.title}</SidebarGroupLabel>
      <SidebarMenu>{group.items.map(({ href, label }) => {
        const Icon = routeIcon(href);
        return <SidebarMenuItem key={href}><SidebarMenuButton asChild isActive={isActiveRoute(pathname, href)} tooltip={label}>
          <Link href={href} aria-current={isActiveRoute(pathname, href) ? "page" : undefined} onClick={() => setOpenMobile(false)}>
            <Icon aria-hidden="true" /><span>{label}</span>
            {href === "/enterprise/inbox" && pendingTasks > 0 && <Badge variant="secondary" className="ml-auto">{pendingTasks > 99 ? "99+" : pendingTasks}</Badge>}
          </Link>
        </SidebarMenuButton></SidebarMenuItem>;
      })}</SidebarMenu>
    </SidebarGroup>)}</nav></SidebarContent>
    <SidebarFooter><SidebarMenu><SidebarMenuItem><SidebarMenuButton size="lg" asChild>
      <Link href={home}><span className="workspace-avatar">{fullName.slice(0, 2).toUpperCase()}</span><span className="grid min-w-0 flex-1"><strong className="truncate">{fullName}</strong><small className="truncate text-muted-foreground">{roleName}</small></span><ChevronRight className="size-4" /></Link>
    </SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarFooter>
  </Sidebar>;
}
