"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/ledger/utils";
import { t } from "@/lib/ledger/i18n";
import type { LedgerNavGroup } from "@/lib/ledger/navigation";

export function SidebarNav({ groups, onNavigate }: { groups: LedgerNavGroup[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label={t("Điều hướng chính")} className="flex flex-col gap-5 px-3 py-4">{groups.map(group => <div key={group.label} className="flex flex-col gap-0.5"><div className="px-2 pb-1 text-[11px] font-semibold tracking-[0.06em] text-ink-2 uppercase">{group.label}</div>{group.items.map(item => {
    const active = pathname === item.href || (!["/admin", "/enterprise"].includes(item.href) && pathname.startsWith(item.href + "/"));
    return <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex h-8 items-center justify-between gap-2 rounded-[5px] px-2 text-[13px] transition-colors", active ? "bg-brand-weak font-semibold text-brand-ink" : "text-ink hover:bg-sunken")}><span className="truncate">{item.label}</span>{item.readOnly && <span className="text-[10px] tracking-wide text-ink-2/80 uppercase" title={t("Chỉ đọc theo API")}>{t("đọc")}</span>}</Link>;
  })}</div>)}</nav>;
}
