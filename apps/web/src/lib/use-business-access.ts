"use client";
import { useEffect, useState } from "react";
import { request } from "./api-client";
import { getAuthorizationScope } from "./auth-scope";
import { clearStoredIotReadings } from "./iot-local-store";
import {
  PERMISSION_SYNC_EVENT,
  PERMISSION_SYNC_KEY,
  PERMISSION_CHECK_EVENT,
  acceptBusinessAccessRevision,
  invalidateBusinessAccess,
} from "./permission-sync";
import type { AuthUser } from "./types";

type Status = "checking" | "ready" | "unavailable";
function tabHidden() {
  return document.visibilityState === "hidden";
}
export function useBusinessAccess(user: AuthUser | null) {
  const [scope, setScope] = useState<{
    identity: string;
    revision?: string;
    productionAccess?: boolean;
    status: Status;
  }>({ identity: "", status: "checking" });
  const identity = getAuthorizationScope(
    user && { ...user, accessRevision: undefined },
  );
  useEffect(() => {
    if (!user) return;
    let active = true;
    let running = false;
    let recheck = false;
    let previous: string | undefined;
    let productionAccess: boolean | undefined;
    const forget = () =>
      clearStoredIotReadings(
        getAuthorizationScope({ ...user, accessRevision: previous }),
      );
    const check = async (foreground = false) => {
      if (!active || tabHidden()) return;
      if (foreground)
        setScope({
          identity,
          revision: previous,
          productionAccess,
          status: "checking",
        });
      if (running) {
        recheck = true;
        return;
      }
      running = true;
      try {
        const context = await request<{
          accessRevision?: string;
          productionChains?: { id: string }[];
        }>("/chain-permissions");
        if (!active) return;
        if (
          !context.accessRevision ||
          !/^[a-f0-9]{64}$/.test(context.accessRevision)
        )
          throw new Error("Missing current permission revision");
        if (previous !== context.accessRevision) forget();
        acceptBusinessAccessRevision(context.accessRevision);
        previous = context.accessRevision;
        productionAccess = (context.productionChains?.length ?? 0) > 0;
        setScope({
          identity,
          revision: previous,
          productionAccess,
          status: tabHidden() ? "checking" : "ready",
        });
      } catch {
        if (active) {
          forget();
          invalidateBusinessAccess();
          setScope({
            identity,
            revision: previous,
            productionAccess,
            status: "unavailable",
          });
        }
      } finally {
        running = false;
        if (recheck && active) {
          recheck = false;
          void check(true);
        }
      }
    };
    const refresh = () => {
      void check(true);
    };
    const changed = () => {
      void check(false);
    };
    const storage = (event: StorageEvent) => {
      if (event.key === PERMISSION_SYNC_KEY || event.key === null) refresh();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden")
        setScope({
          identity,
          revision: previous,
          productionAccess,
          status: "checking",
        });
      else refresh();
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", storage);
    window.addEventListener(PERMISSION_SYNC_EVENT, refresh);
    window.addEventListener(PERMISSION_CHECK_EVENT, changed);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(changed, 60000);
    refresh();
    return () => {
      active = false;
      forget();
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", storage);
      window.removeEventListener(PERMISSION_SYNC_EVENT, refresh);
      window.removeEventListener(PERMISSION_CHECK_EVENT, changed);
      document.removeEventListener("visibilitychange", visibility);
    };
    // Token refresh does not change the identity or remount in-flight forms.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  return scope.identity === identity
    ? scope
    : {
        identity,
        revision: undefined,
        productionAccess: undefined,
        status: "checking" as const,
      };
}
