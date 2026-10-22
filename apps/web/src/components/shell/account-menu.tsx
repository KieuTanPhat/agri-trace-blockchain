"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import type { NavItem } from "@/lib/management-routes";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
export function AccountMenu({ fullName, roleName, links, pathname, onLogout }: {
  fullName: string; roleName: string; links: NavItem[]; pathname: string; onLogout(): void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);
  return <DropdownMenu open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`Tài khoản: ${fullName}`}><span className="workspace-avatar">{fullName.slice(0, 2).toUpperCase()}</span></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-56">
      <DropdownMenuLabel><strong className="block">{fullName}</strong><span className="text-xs font-normal text-muted-foreground">{roleName}</span></DropdownMenuLabel>
      <DropdownMenuSeparator />
      {links.map(({ href, label }) => <DropdownMenuItem key={href} asChild><Link href={href}>{label}</Link></DropdownMenuItem>)}
      <DropdownMenuItem asChild><Link href="/scan">Quét mã QR</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/">Trang giới thiệu</Link></DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onLogout}><LogOut className="size-4" />Đăng xuất</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
