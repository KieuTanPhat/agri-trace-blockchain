"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useLedgerQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import { t } from "@/lib/ledger/i18n";
import { useLocale } from "./locale";
import { Callout } from "./kit/page";
import { Button } from "./ui/button";
type Notice = {
  id: string;
  title: string;
  body: string;
  severity: string;
  endsAt: string;
};
const DISMISSED = "agritrace:dismissed-notices:v1";
export function LedgerSystemNotices() {
  useLocale();
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const ids: unknown = JSON.parse(
        sessionStorage.getItem(DISMISSED) ?? "[]",
      );
      setDismissed(
        Array.isArray(ids)
          ? ids.filter((id): id is string => typeof id === "string")
          : [],
      );
    } catch {
      setDismissed([]);
    }
  }, []);
  const query = useLedgerQuery({
    queryKey: ["notices-active"],
    queryFn: () => ledgerRequest<{ items: Notice[] }>("/system-notices/active"),
  });
  if (!dismissed) return null;
  const visible =
    query.data?.items.filter((notice) => !dismissed.includes(notice.id)) ?? [];
  if (!visible.length) return null;
  return (
    <aside
      data-testid="ledger-system-notices"
      aria-label={t("Thông báo hệ thống")}
      className="grid gap-2 px-4 py-3 sm:px-7"
    >
      {visible.map((notice) => (
        <Callout
          key={notice.id}
          title={notice.title}
          tone={notice.severity === "INFO" ? "info" : "warn"}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 whitespace-pre-line break-words">
              {notice.body}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Ẩn thông báo")}
              onClick={() => {
                const next = [...dismissed, notice.id];
                setDismissed(next);
                try {
                  sessionStorage.setItem(DISMISSED, JSON.stringify(next));
                } catch {
                  /* Session storage may be unavailable. */
                }
              }}
            >
              <X aria-hidden />
            </Button>
          </div>
        </Callout>
      ))}
    </aside>
  );
}
