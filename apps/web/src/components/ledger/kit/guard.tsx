"use client";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { ledgerHomeRoute } from "@/lib/ledger/session-navigation";
import { t } from "@/lib/ledger/i18n";
export function Guard({
  permission,
  children,
}: {
  permission: string;
  children: React.ReactNode;
}) {
  const { can, user } = useLedgerSession();
  if (can(permission)) return children;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-24 text-center">
      <ShieldOff aria-hidden className="size-7 text-ink-2" />
      <h1 className="text-[18px] font-semibold">
        {t("Không có quyền truy cập")}
      </h1>
      <p className="max-w-md text-[13px] text-ink-2">
        {t("Tài khoản hiện tại không có quyền mở nội dung này.")}
      </p>
      <Link
        href={user ? ledgerHomeRoute(user) : "/login"}
        className="text-[13px] text-brand hover:underline"
      >
        {t("Về trang đầu")}
      </Link>
    </div>
  );
}
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useLedgerSession();
  return can(permission) ? children : fallback;
}
