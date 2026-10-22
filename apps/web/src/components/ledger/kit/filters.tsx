"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ledger/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ledger/ui/select";
import { Button } from "@/components/ledger/ui/button";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const ALL = "__all__";

export function FilterSelect({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; className?: string }) {
  return (
    <Select value={value || ALL} onValueChange={(v) => onChange(v === ALL ? "" : v)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("h-8 min-w-[150px] bg-card text-[13px]", value && "border-brand text-brand-ink", className)}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}{tr(": tất cả")}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function FilterBar({ children, search, onSearch, placeholder, active, onReset }: { children?: React.ReactNode; search?: string; onSearch?: (v: string) => void; placeholder?: string; active?: boolean; onReset?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {onSearch && <Input aria-label={placeholder ?? tr("Tìm kiếm")} placeholder={placeholder} value={search} onChange={(e) => onSearch(e.target.value)} className="h-8 w-full bg-card sm:w-64" />}
      {children}
      {active && onReset && (
        <Button variant="ghost" size="sm" onClick={onReset}>
          <X /> {tr("Xóa lọc")}
        </Button>
      )}
    </div>
  );
}
