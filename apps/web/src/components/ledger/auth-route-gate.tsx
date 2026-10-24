"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { t } from "@/lib/ledger/i18n";
import { ErrorState } from "./kit/page";
import {LedgerPortalScope} from "./portal-scope";
import { isCustomerPage } from "@/lib/site-origins";

const PUBLIC = new Set([
  "/",
  "/login",
  "/register",
  "/join-organization",
  "/terms",
  "/privacy",
  "/scan",
]);
/** Initial access is checked before mounting. Rechecks hide and disable the same identity's mounted forms. */
export function LedgerAuthRouteGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const path = usePathname(),
    router = useRouter();
  const { user, isLoading, privateAccessStatus } = useAuth();
  const identity = getAuthorizationScope(
    user && { ...user, accessRevision: undefined },
  );
  const admitted = useRef<string | null>(null);
  const [portalContainer,setPortalContainer]=useState<HTMLDivElement|null>(null);
  if (privateAccessStatus === "ready" && user) admitted.current = identity;
  const publicRoute =
    PUBLIC.has(path) || path === "/trace" || path.startsWith("/trace/") || isCustomerPage(path);
  useEffect(() => {
    if (publicRoute || isLoading) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(path)}`);
    else if (user.mustChangePassword && path !== "/account/password")
      router.replace("/account/password");
  }, [path, publicRoute, isLoading, user, router]);
  if (publicRoute) return children;
  if (
    isLoading ||
    !user ||
    (user.mustChangePassword && path !== "/account/password")
  )
    return (
      <div
        role="status"
        className="grid min-h-dvh place-items-center text-[13px] text-ink-2"
      >
        {t("Đang kiểm tra phiên đăng nhập…")}
      </div>
    );
  if (path === "/account/password") return <div key={identity}>{children}</div>;
  const ready = privateAccessStatus === "ready";
  return (
    <>
      {!ready &&
        (privateAccessStatus === "unavailable" ? (
          <div className="pointer-events-auto" onPointerDownCapture={event=>event.stopPropagation()} onKeyDownCapture={event=>event.stopPropagation()}><ErrorState
            error={{
              status: 503,
              message: t("Chưa xác minh được quyền truy cập"),
            }}
            onRetry={() => window.dispatchEvent(new Event("focus"))}
          /></div>
        ) : (
          <div
            role="status"
            className="grid min-h-dvh place-items-center text-[13px] text-ink-2"
          >
            {t("Đang kiểm tra phiên đăng nhập…")}
          </div>
        ))}
      <div key={identity} hidden={!ready} inert={!ready} ref={setPortalContainer}>
        <LedgerPortalScope value={portalContainer}>{admitted.current === identity ? children : null}</LedgerPortalScope>
      </div>
    </>
  );
}
