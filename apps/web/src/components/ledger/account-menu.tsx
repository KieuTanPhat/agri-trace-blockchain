"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "@/lib/auth-store";
import { t } from "@/lib/ledger/i18n";
import { AgritraceLogo } from "./brand";
import { LanguageSwitch, useLocale } from "./locale";
import { useLedgerSignOut } from "./sign-out";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** Account controls only: business access failures must not hide this menu. */
export function LedgerAccountMenu({ children }: { children?: ReactNode }) {
  useLocale();
  const { user } = useAuth();
  const signOut = useLedgerSignOut();
  if (!user) return null;
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label={t("Tài khoản")} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-sunken">
        <span className="hidden flex-col items-end leading-tight md:flex">
          <span className="text-[13px] font-medium">{user.fullName}</span>
          <span className="text-[11px] text-ink-2">{user.role.name}</span>
        </span>
        <span aria-hidden className="inline-flex size-7 items-center justify-center rounded-full bg-sunken text-[12px] font-semibold">{user.fullName.split(" ").pop()?.[0]}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-64">
      <DropdownMenuLabel className="flex flex-col gap-0.5">
        <span>{user.fullName}</span>
        <span className="font-mono text-[11px] font-normal text-ink-2">{user.email}</span>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild><Link href="/account/password"><ShieldCheck />{t("Đổi mật khẩu")}</Link></DropdownMenuItem>
      <DropdownMenuItem asChild><Link href="/account/privacy">{t("Quyền dữ liệu cá nhân")}</Link></DropdownMenuItem>
      {children}
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={signOut.pending} onSelect={() => void signOut.run()}>
        <LogOut />{signOut.pending ? t("Đang đăng xuất…") : t("Đăng xuất")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Session header for access errors; it exposes no business records or actions. */
export function LedgerAccountBoundary({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh flex-col bg-canvas">
    <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-card px-4 sm:px-7">
      <Link href="/" aria-label="AgriTrace"><AgritraceLogo height={28} /></Link>
      <div className="ml-auto flex items-center gap-2"><LanguageSwitch /><LedgerAccountMenu /></div>
    </header>
    <main className="grid flex-1 place-items-center px-4 py-8">{children}</main>
  </div>;
}
