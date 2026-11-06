"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { t } from "@/lib/ledger/i18n";

/** Logout is an account action, independent of business permissions. */
export function useLedgerSignOut() {
  const { logout } = useAuth();
  const router = useRouter();
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  async function run() {
    if (sending.current) return;
    sending.current = true;
    setPending(true);
    try {
      await logout();
      router.replace("/login");
    } catch {
      // Do not claim success when the server has not revoked its cookie session.
      toast.error(t("Không thể đăng xuất. Kiểm tra kết nối máy chủ rồi thử lại."));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return { run, pending };
}

