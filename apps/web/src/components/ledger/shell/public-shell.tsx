"use client";
import { customerHref } from "@/lib/site-origins";
import Link from "next/link";
import { AgritraceLogo } from "../brand";
import { LanguageSwitch, useLocale } from "../locale";
import { LedgerThemeToggle } from "./app-shell";
import { t } from "@/lib/ledger/i18n";
export function LedgerPublicShell({ children }: { children: React.ReactNode }) {
  useLocale();
  return <div className="flex min-h-dvh flex-col"><header className="border-b border-line bg-card"><div className="mx-auto flex h-16 max-w-[1360px] items-center justify-between gap-3 px-4 sm:px-7"><Link href={customerHref("/")} aria-label="AgriTrace"><AgritraceLogo height={30} priority /></Link><div className="flex items-center gap-2"><LanguageSwitch /><LedgerThemeToggle /></div></div></header><main className="flex min-w-0 flex-1 flex-col">{children}</main><footer className="border-t border-line bg-card"><div className="mx-auto flex max-w-[1360px] flex-wrap gap-5 px-4 py-5 text-[12px] text-ink-2 sm:px-7"><span>AgriTrace</span><Link href="/terms" className="hover:text-brand">{t("Điều khoản")}</Link><Link href="/privacy" className="hover:text-brand">{t("Quyền riêng tư")}</Link></div></footer></div>;
}
