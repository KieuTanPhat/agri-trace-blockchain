"use client";

import { Fragment, useEffect, useSyncExternalStore } from "react";
import { getLocale, restoreLocale, setLocale, subscribeLocale, type Locale } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, () => "vi");
}

/** Dựng lại cây giao diện khi đổi ngôn ngữ (state phiên và cache dữ liệu nằm ở trên, không mất). */
export function LocaleBoundary({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  useEffect(() => restoreLocale(), []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return <Fragment>{children}</Fragment>;
}

export function LanguageSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  return (
    <div role="group" aria-label={tr("Language / Ngôn ngữ")} className={cn("inline-flex h-7 overflow-hidden rounded-md border border-line text-[11.5px] font-semibold", className)}>
      {(["vi", "en"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={locale === l}
          onClick={() => setLocale(l)}
          className={cn("px-2", locale === l ? "bg-ink text-canvas" : "bg-card text-ink-2 hover:text-ink")}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
