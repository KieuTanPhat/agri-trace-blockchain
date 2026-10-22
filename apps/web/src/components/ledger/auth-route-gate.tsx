"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { t } from "@/lib/ledger/i18n";
import { ErrorState } from "./kit/page";

const PUBLIC = new Set(["/", "/login", "/register", "/join-organization", "/terms", "/privacy", "/scan"]);
/** A DOM-free gate around route children. Unmigrated private renderers cannot mount during auth checks. */
export function LedgerAuthRouteGate({ children }: { children: React.ReactNode }) {
  const path = usePathname(), router = useRouter();
  const { user, isLoading, privateAccessStatus } = useAuth();
  const publicRoute = PUBLIC.has(path) || path === "/trace" || path.startsWith("/trace/");
  useEffect(() => {
    if (publicRoute || isLoading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (user.mustChangePassword && path !== "/account/password") router.replace("/account/password");
  }, [path, publicRoute, isLoading, user, router]);
  if (publicRoute) return children;
  if (isLoading || !user || (user.mustChangePassword && path !== "/account/password")) return <div role="status" className="grid min-h-dvh place-items-center text-[13px] text-ink-2">{t("Đang kiểm tra phiên đăng nhập…")}</div>;
  if (path === "/account/password") return children;
  if (privateAccessStatus === "unavailable") return <ErrorState error={{ status: 503, message: t("Chưa xác minh được quyền truy cập") }} onRetry={() => window.dispatchEvent(new Event("focus"))} />;
  if (privateAccessStatus !== "ready") return <div role="status" className="grid min-h-dvh place-items-center text-[13px] text-ink-2">{t("Đang kiểm tra phiên đăng nhập…")}</div>;
  return children;
}
