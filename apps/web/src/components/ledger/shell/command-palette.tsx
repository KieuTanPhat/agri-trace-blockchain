"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "../ui/command";
import { t } from "@/lib/ledger/i18n";
import type { LedgerNavGroup } from "@/lib/ledger/navigation";
export function CommandPalette({ open, onOpenChange, groups }: { open: boolean; onOpenChange: (open: boolean) => void; groups: LedgerNavGroup[] }) {
  const router = useRouter(), [q, setQ] = useState("");
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); onOpenChange(!open); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);
  return <CommandDialog open={open} onOpenChange={onOpenChange} title={t("Tìm nhanh")} description={t("Đi tới trang, tổ chức hoặc tra cứu lô")}><CommandInput placeholder={t("Tìm trang, tổ chức, mã lô, mã QR…")} value={q} onValueChange={setQ} /><CommandList><CommandEmpty>{t("Không có kết quả.")}</CommandEmpty>{groups.map(group => <CommandGroup key={group.label} heading={group.label}>{group.items.map(item => <CommandItem key={item.href} value={`${item.label} ${item.keywords ?? ""}`} onSelect={() => { onOpenChange(false); setQ(""); router.push(item.href); }}><Search />{item.label}</CommandItem>)}</CommandGroup>)}</CommandList></CommandDialog>;
}
